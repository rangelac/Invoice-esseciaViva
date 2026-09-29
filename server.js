import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cieloClient } from './cielo.js';
import { readQuote, demoQuote } from './currency.js';
import {installBitcoin,satoshis} from './bitcoin.js';
import {currencies,invoiceValue} from './invoice-money.js';
import {renderInvoicePdf} from './invoice-pdf.js';
const root = dirname(fileURLToPath(import.meta.url));
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function amountInCents(value) {
  if (typeof value !== 'string' || !/^\d{1,6}([.,]\d{1,2})?$/.test(value)) throw new Error('Informe um valor válido, sem separador de milhar.');
  const [reais,cents=''] = value.replace(',','.').split('.');
  const amount = Number(reais)*100+Number(cents.padEnd(2,'0'));
  if(amount<100 || amount>10000000) throw new Error('O valor deve estar entre R$ 1 e R$ 100.000.');
  return amount;
}
export function paymentState(status) {
  return ({1:'authorized',2:'paid',3:'declined',10:'cancelled',11:'refunded',13:'cancelled'})[status] || 'review';
}
export function createApp(env=process.env, provider, bitcoinFetch) {
  const mode=env.PAYMENT_MODE || 'demo';
  if(!['demo','sandbox','production'].includes(mode)) throw new Error('PAYMENT_MODE inválido.');
  if(!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length<16) throw new Error('Configure ADMIN_PASSWORD com ao menos 16 caracteres.');
  const origin=new URL(env.PUBLIC_URL || 'http://localhost:3000').origin;
  const secure=origin.startsWith('https://');
  if(mode==='production' && (!secure || env.ENABLE_LIVE_PAYMENTS!=='true')) throw new Error('Produção exige HTTPS e ENABLE_LIVE_PAYMENTS=true.');
  if(mode!=='demo') for(const key of ['CIELO_MERCHANT_ID','CIELO_MERCHANT_KEY','CIELO_SOP_CLIENT_ID','CIELO_SOP_CLIENT_SECRET']) if(!env[key]) throw new Error(`Configure ${key}.`);
  const dccEnabled=mode==='demo' || env.CIELO_DCC_ENABLED==='true';
  if(mode==='sandbox' && dccEnabled && !provider) throw new Error('DCC não é oferecido no sandbox Cielo. Use demo para simular.');
  const markupPercent=Number(env.CIELO_DCC_MARKUP_PERCENT || 16);
  if(!Number.isFinite(markupPercent) || markupPercent<0 || markupPercent>100) throw new Error('Markup DCC inválido.');
  const client=provider || cieloClient({...env,PAYMENT_MODE:mode});
  const file=env.DB_PATH || resolve(root,`data/${mode}.sqlite`);
  if(file!==':memory:') mkdirSync(dirname(file),{recursive:true});
  const db=new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY, request_key TEXT UNIQUE NOT NULL, order_id TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL, description TEXT NOT NULL, amount INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'open', payment_id TEXT, checked_at TEXT);
  `);
  const columns=db.prepare('PRAGMA table_info(invoices)').all().map(c=>c.name);
  for(const [column,type] of Object.entries({dcc_requested:'INTEGER NOT NULL DEFAULT 0',dcc_started_at:'TEXT',quote_json:'TEXT',choice_currency:'TEXT',choice_at:'TEXT',invoice_currency:"TEXT NOT NULL DEFAULT 'BRL'",invoice_minor:'INTEGER',invoice_digits:'INTEGER NOT NULL DEFAULT 2',invoice_number:'TEXT',billing_address:"TEXT NOT NULL DEFAULT ''"})) {
    if(!columns.includes(column)) db.exec(`ALTER TABLE invoices ADD COLUMN ${column} ${type}`);
  }
  db.exec("UPDATE invoices SET invoice_minor=amount WHERE invoice_minor IS NULL; UPDATE invoices SET invoice_number=printf('EV-%06d',rowid) WHERE invoice_number IS NULL");
  // A process restart must never unlock an attempt whose result is unknown.
  db.exec("UPDATE invoices SET state='review' WHERE state='processing'");
  const sessions=new Map();
  const salt=randomBytes(16), passwordHash=scryptSync(env.ADMIN_PASSWORD,salt,32);
  const app=express();
  app.disable('x-powered-by');
  app.use(helmet({contentSecurityPolicy:{directives:{'script-src':["'self'",'https://transactionsandbox.pagador.com.br','https://transactionscus.pagador.com.br','https://www.pagador.com.br'], 'connect-src':["'self'",'https://transactionsandbox.pagador.com.br','https://transaction.pagador.com.br','https://transaction.cieloecommerce.cielo.com.br','https://transactionsandbox.cieloecommerce.cielo.com.br','https://transactionscus.pagador.com.br','https://www.pagador.com.br'], 'upgrade-insecure-requests':secure?[]:null}},referrerPolicy:{policy:'no-referrer'},strictTransportSecurity:secure?undefined:false}));
  app.use('/api',rateLimit({windowMs:60000,limit:120,standardHeaders:'draft-8',legacyHeaders:false}));
  app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store'); if(req.method!=='GET' && (req.get('Origin')!==origin || req.get('X-Essencia-Request')!=='1')) return res.status(403).json({error:'Origem da solicitação inválida.'}); next();});
  app.use(express.json({limit:'8kb'}));
  function auth(req,res,next) {
    const id=(req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('ev_session='))?.slice(11);
    const expires=sessions.get(id);
    if(!expires || expires<Date.now()) { sessions.delete(id); return res.status(401).json({error:'Entre no painel para continuar.'}); }
    req.sessionId=id; next();
  }
  function getInvoice(id) { return db.prepare('SELECT * FROM invoices WHERE id=?').get(id); }
  function exposed(row,admin=false) {
    const quote=row.quote_json?JSON.parse(row.quote_json):null;
    const quoteExpired=row.state==='currency_choice' && quote && Date.parse(quote.expiresAt)<=Date.now();
    const state=quoteExpired?'quote_expired':row.state==='open' && Date.parse(row.expires_at)<Date.now()?'expired':row.state;
    return {id:row.id,description:row.description,amount:row.amount,expiresAt:row.expires_at,createdAt:row.created_at,state,mode,bitcoinEnabled:bitcoin.enabled,bitcoinAmount:row.btc_sats || null,paymentMethod:row.payment_method,currency:'BRL',invoiceCurrency:row.invoice_currency,invoiceAmount:row.invoice_minor,invoiceDigits:row.invoice_digits,number:row.invoice_number,pdfUrl:`${origin}/api/public/${row.id}/pdf`,dccEnabled:dccEnabled && row.invoice_currency==='BRL',quote,chosenCurrency:row.choice_currency,choiceAt:row.choice_at,...(admin?{name:row.name,email:row.email,billingAddress:row.billing_address,bitcoinTxid:row.btc_txid,bitcoinVout:row.btc_vout,orderId:row.order_id,checkedAt:row.checked_at,url:`${origin}/p/${row.id}`}:{})};
  }
  function available(row) { return row && row.state==='open' && Date.parse(row.expires_at)>Date.now(); }
  app.post('/api/login',rateLimit({windowMs:15*60000,limit:10,skipSuccessfulRequests:true}), (req,res)=>{
    const password=req.body?.password;
    if(typeof password!=='string' || password.length>512 || !timingSafeEqual(scryptSync(password,salt,32),passwordHash)) return res.status(401).json({error:'Senha incorreta.'});
    for(const [key,expiry] of sessions) if(expiry<Date.now()) sessions.delete(key);
    const token=randomBytes(32).toString('hex'); sessions.set(token,Date.now()+8*3600000);
    res.setHeader('Set-Cookie',`ev_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure?'; Secure':''}`);
    res.json({ok:true});
  });
  app.post('/api/logout',auth,(req,res)=>{sessions.delete(req.sessionId);res.setHeader('Set-Cookie','ev_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');res.json({ok:true});});
  app.get('/api/invoices',auth,(req,res)=>res.json({mode,currencies,invoices:db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all().map(r=>exposed(r,true))}));
  app.post('/api/invoices',auth,(req,res)=>{
    try {
      const {name,email='',description,amount,dueDate,requestKey,currency='BRL',bitcoinAmount='',equivalentBrl='',billingAddress=''}=req.body || {};
      const invoiceMoney=invoiceValue(amount,currency);
      const brl=amountInCents(currency==='BRL'?amount:equivalentBrl);
      if(typeof billingAddress!=='string' || billingAddress.length>500)throw new Error('Endereço do doador deve ter até 500 caracteres.');
      if(!uuid.test(requestKey || '')) throw new Error('Identificador da solicitação inválido.');
      const existing=db.prepare('SELECT * FROM invoices WHERE request_key=?').get(requestKey);
      if(existing) return res.json(exposed(existing,true));
      if(typeof name!=='string' || name.trim().length<2 || name.length>120) throw new Error('Informe o nome do doador.');
      if(typeof email!=='string' || email.length>254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error('E-mail inválido.');
      if(typeof description!=='string' || description.trim().length<3 || description.length>300) throw new Error('Descreva a finalidade da doação.');
      if(typeof dueDate!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || new Date(dueDate+'T12:00:00Z').toISOString().slice(0,10)!==dueDate) throw new Error('Data inválida.');
      const expires=new Date(dueDate+'T23:59:59-05:00');
      if(expires.getTime()<Date.now() || expires.getTime()>Date.now()+366*86400000) throw new Error('Escolha uma data entre hoje e um ano.');
      const btc=currency==='BTC'?invoiceMoney.minor:(bitcoinAmount?satoshis(bitcoinAmount):null);
      if(currency==='BTC' && bitcoinAmount && satoshis(bitcoinAmount)!==btc)throw new Error('Valor alternativo BTC diverge da moeda principal.');
      if(btc && !bitcoin.enabled) throw new Error('Bitcoin não habilitado neste ambiente.');
      const id=randomBytes(24).toString('base64url');
      db.prepare('INSERT INTO invoices(id,request_key,order_id,name,email,description,amount,expires_at,created_at,btc_sats,invoice_currency,invoice_minor,invoice_digits,billing_address) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,requestKey,randomBytes(12).toString('hex'),name.trim(),email.trim(),description.trim(),brl,expires.toISOString(),new Date().toISOString(),btc,currency,invoiceMoney.minor,invoiceMoney.digits,billingAddress.trim());
      db.prepare("UPDATE invoices SET invoice_number=printf('EV-%06d',rowid) WHERE id=?").run(id);
      res.status(201).json(exposed(getInvoice(id),true));
    } catch(e) {res.status(400).json({error:e.message});}
  });
  app.get('/api/public/:id',(req,res)=>{const row=getInvoice(req.params.id); if(!row)return res.status(404).json({error:'Cobrança não encontrada.'});res.json(exposed(row));});
  const payLimit=rateLimit({windowMs:15*60000,limit:20});
  const bitcoin=installBitcoin(app,{db,env,mode,auth,exposed,getInvoice,available,payLimit,fetcher:bitcoinFetch});
  app.post('/api/public/:id/sop',payLimit,async(req,res)=>{
    if(!available(getInvoice(req.params.id))) return res.status(409).json({error:'Esta cobrança não está disponível para pagamento.'});
    if(mode==='demo') return res.json({demo:true});
    try {res.json(await client.sop());} catch {res.status(502).json({error:'Não foi possível preparar o cartão. Tente novamente mais tarde.'});}
  });
  function savePayment(row,result,initial=false) {
    const payment=result?.Payment;
    if(!payment || !uuid.test(payment.PaymentId || '') || result.MerchantOrderId!==row.order_id || payment.Amount!==row.amount || payment.Type!=='CreditCard' || (payment.Currency && payment.Currency!=='BRL')) throw new Error('Resposta não conciliada.');
    if(initial && row.dcc_requested && payment.Status===12 && !row.choice_at) {
      // Persist the provider ID before parsing so malformed quotes can still be reconciled.
      db.prepare('UPDATE invoices SET payment_id=? WHERE id=?').run(payment.PaymentId,row.id);
      const quote=readQuote(payment,row.amount,row.dcc_started_at,markupPercent);
      db.prepare("UPDATE invoices SET state='currency_choice',quote_json=?,checked_at=? WHERE id=?").run(JSON.stringify(quote),new Date().toISOString(),row.id);
      return;
    }
    // Some legacy DCC docs use 11 for ineligible cards; never mistake it for a refund.
    const state=row.dcc_requested && !row.choice_at && payment.Status===11?'review':paymentState(payment.Status);
    db.prepare('UPDATE invoices SET state=?,payment_id=?,checked_at=? WHERE id=?').run(state,payment.PaymentId,new Date().toISOString(),row.id);
  }
  app.post('/api/public/:id/pay',payLimit,async(req,res)=>{
    const row=getInvoice(req.params.id);
    if(!available(row)) return res.status(409).json({error:'Pagamento já enviado, vencido ou em conferência. Consulte o status antes de pagar novamente.'});
    const {paymentToken,brand,demo,demoCurrency} = req.body || {};
    if(Object.keys(req.body || {}).some(k=>!['paymentToken','brand','demo','demoCurrency'].includes(k)))return res.status(400).json({error:'Envie somente o token do cartão.'});
    if(mode==='demo' ? demo!==true : (!uuid.test(paymentToken || '') || !['Visa','Master','Elo','Amex','Diners','JCB','Discover','Hipercard'].includes(brand))) return res.status(400).json({error:'Dados do pagamento inválidos.'});
    if(demoCurrency!==undefined && (mode!=='demo' || !['USD','EUR','GBP','JPY','KWD'].includes(demoCurrency))) return res.status(400).json({error:'Moeda de demonstração inválida.'});
    if(row.invoice_currency!=='BRL' && demoCurrency)return res.status(400).json({error:'A moeda desta fatura já foi definida. O cartão usa o equivalente em BRL informado na emissão.'});
    const requestDcc=row.invoice_currency==='BRL' && (mode==='demo'?Boolean(demoCurrency):dccEnabled && ['Visa','Master'].includes(brand));
    const startedAt=new Date().toISOString();
    const locked=db.prepare("UPDATE invoices SET state='processing',dcc_requested=?,dcc_started_at=? WHERE id=? AND state='open'").run(requestDcc?1:0,requestDcc?startedAt:null,row.id);
    if(!locked.changes)return res.status(409).json({error:'Pagamento já em andamento.'});
    try {
      const current=getInvoice(row.id);
      if(mode==='demo' && demoCurrency) savePayment(current,{MerchantOrderId:row.order_id,Payment:{PaymentId:randomUUID(),Type:'CreditCard',Amount:row.amount,Status:12,CurrencyExchangeData:{CurrencyExchanges:[demoQuote(demoCurrency,row.amount)]}}},true);
      else if(mode==='demo') db.prepare("UPDATE invoices SET state='paid',checked_at=? WHERE id=?").run(new Date().toISOString(),row.id);
      else savePayment(current,await client.create(current,paymentToken,brand),true);
      res.json(exposed(getInvoice(row.id)));
    } catch {
      db.prepare("UPDATE invoices SET state='review' WHERE id=?").run(row.id);
      res.status(202).json(exposed(getInvoice(row.id)));
    }
  });
  app.post('/api/public/:id/confirm-currency',payLimit,async(req,res)=>{
    const row=getInvoice(req.params.id), currency=req.body?.currency;
    if(!row || row.state!=='currency_choice') return res.status(409).json({error:'Esta conversão já foi enviada ou não está disponível.'});
    const quote=JSON.parse(row.quote_json);
    if(Date.parse(quote.expiresAt)<=Date.now()) return res.status(409).json({error:'A cotação expirou. Solicite à organização a conferência da cobrança.'});
    if(Object.keys(req.body || {}).length!==1 || (currency!=='BRL' && !quote.exchanges.some(o=>o.currency===currency))) return res.status(400).json({error:'Escolha uma das moedas oferecidas pela Cielo.'});
    const lock=db.prepare("UPDATE invoices SET state='processing',choice_currency=?,choice_at=? WHERE id=? AND state='currency_choice'").run(currency,new Date().toISOString(),row.id);
    if(!lock.changes) return res.status(409).json({error:'Confirmação já em andamento.'});
    try {
      if(mode==='demo') db.prepare("UPDATE invoices SET state='paid',checked_at=? WHERE id=?").run(new Date().toISOString(),row.id);
      else {
        await client.confirm(row.payment_id,currency!=='BRL');
        // Confirm responses lack order/amount. Independently query before marking paid.
        const result=await client.query(row.payment_id);
        if(result?.Payment?.PaymentId!==row.payment_id) throw new Error('Pagamento divergente.');
        savePayment(getInvoice(row.id),result);
      }
      res.json(exposed(getInvoice(row.id)));
    } catch {
      db.prepare("UPDATE invoices SET state='review' WHERE id=?").run(row.id);
      res.status(202).json(exposed(getInvoice(row.id)));
    }
  });
  app.post('/api/invoices/:id/refresh',auth,async(req,res)=>{
    const row=getInvoice(req.params.id);
    if(!row)return res.status(404).json({error:'Cobrança não encontrada.'});
    if(row.payment_method==='bitcoin') return res.status(400).json({error:'Use Conferir Bitcoin. Este pagamento não passa pela Cielo.'});
    if(mode==='demo' || row.state==='open' || (row.state==='currency_choice' && Date.parse(JSON.parse(row.quote_json).expiresAt)>Date.now())) return res.json(exposed(row,true));
    if(row.state==='processing') return res.status(409).json({error:'Aguarde a conclusão do envio.'});
    try {
      let id=row.payment_id;
      if(!id) {
        const matches=await client.find(row.order_id);
        if(!Array.isArray(matches.Payments) || matches.Payments.length!==1) throw new Error('Conciliação manual necessária.');
        id=matches.Payments[0].PaymentId;
      }
      if(!uuid.test(id || ''))throw new Error('Pagamento não localizado.');
      const result=await client.query(id);
      if(result?.Payment?.PaymentId!==id)throw new Error('Pagamento divergente.');
      if(getInvoice(row.id).state!==row.state) return res.status(409).json({error:'A situação mudou. Atualize a lista.'});
      savePayment(row,result,Boolean(row.dcc_requested && !row.choice_at && !row.quote_json));res.json(exposed(getInvoice(row.id),true));
    } catch {res.status(502).json({error:'Não foi possível confirmar na Cielo. Mantenha a cobrança em conferência e verifique no painel Cielo antes de criar outra.'});}
  });
  async function pdf(req,res,admin){
    const row=getInvoice(req.params.id);if(!row)return res.status(404).json({error:'Fatura não encontrada.'});
    try{const data=exposed(row,admin);const buffer=await renderInvoicePdf({...data,name:admin?row.name:'Doador',email:admin?row.email:'',billingAddress:admin?row.billing_address:'',url:`${origin}/p/${row.id}`});res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="Fatura-${row.invoice_number}.pdf"`,'Cache-Control':'no-store'}).send(buffer);}catch{res.status(503).json({error:'Não foi possível gerar o PDF. Verifique o serviço de documentos e tente novamente.'});}
  }
  app.get('/api/invoices/:id/pdf',auth,(req,res)=>pdf(req,res,true));
  app.get('/api/public/:id/pdf',(req,res)=>pdf(req,res,false));
  app.use(express.static(resolve(root,'public'),{index:false}));
  app.get('/',(req,res)=>res.sendFile(resolve(root,'public/index.html')));
  app.get('/p/:id',(req,res)=>res.sendFile(resolve(root,'public/pay.html')));
  app.use((error,req,res,next)=>res.status(error.status===413?413:400).json({error:'Solicitação inválida.'}));
  return {app,db};
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {app}=createApp();
  app.listen(Number(process.env.PORT || 3000),process.env.HOST || '127.0.0.1',()=>console.log(`Essência Viva disponível em ${process.env.PUBLIC_URL || 'http://localhost:3000'}`));
}
