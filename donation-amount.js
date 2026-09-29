import {randomUUID} from 'node:crypto';
import {invoiceValue} from './invoice-money.js';

export const donationCurrencies=['BRL','USD','EUR','GBP','CAD','AUD','CHF','JPY'];
const demoRates={BRL:1,USD:5,EUR:6,GBP:7,CAD:3.7,AUD:3.3,CHF:6.2,JPY:.035};
export function rateClient(mode,fetcher=fetch){
  const cache=new Map();
  return async currency=>{
    if(!donationCurrencies.includes(currency))throw new Error('Moeda não disponível para ajuste.');
    const today=new Date().toISOString().slice(0,10);
    if(currency==='BRL')return {rate:1,date:today,source:'BRL'};
    if(mode==='demo')return {rate:demoRates[currency],date:today,source:'Demonstração — câmbio fictício'};
    const old=cache.get(currency);
    if(old && old.until>Date.now())return old.value;
    const response=await fetcher(`https://api.frankfurter.dev/v2/rate/${currency.toLowerCase()}/brl`,{signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new Error('Cotação indisponível. Tente novamente ou escolha BRL.');
    const data=await response.json(),date=Date.parse(data.date+'T00:00:00Z');
    if(data.base!==currency || data.quote!=='BRL' || !Number.isFinite(data.rate) || data.rate<=0 || !Number.isFinite(date) || date>Date.now()+86400000 || Date.now()-date>7*86400000)throw new Error('Cotação inválida ou desatualizada. Escolha BRL ou tente mais tarde.');
    const value={rate:data.rate,date:data.date,source:'Frankfurter — referência diária'};
    cache.set(currency,{until:Date.now()+600000,value});return value;
  };
}

export function installDonationAmounts(app,{db,mode,getInvoice,available,payLimit,fetcher}){
  db.exec('CREATE TABLE IF NOT EXISTS donation_quotes(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL,data TEXT NOT NULL,expires_at TEXT NOT NULL)');
  const getRate=rateClient(mode,fetcher);
  app.post('/api/public/:id/donation-quote',payLimit,async(req,res)=>{
    const row=getInvoice(req.params.id);
    if(!available(row) || !row.allow_amount_edit)return res.status(409).json({error:'Esta fatura não permite ajustar o valor neste momento.'});
    const {currency,value}=req.body || {};
    if(Object.keys(req.body || {}).some(k=>!['currency','value'].includes(k)) || !donationCurrencies.includes(currency))return res.status(400).json({error:'Escolha uma moeda disponível.'});
    try{
      const rate=await getRate(currency);
      const digits=new Intl.NumberFormat('pt-BR',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
      const suggested=currency===row.invoice_currency?row.invoice_minor/10**row.invoice_digits:row.amount/100/rate.rate;
      const parsed=invoiceValue(value===undefined?suggested.toFixed(digits):value,currency);
      const brl=Math.round(parsed.minor/10**digits*rate.rate*100);
      if(!Number.isSafeInteger(brl) || brl<100 || brl>10000000)throw new Error('O equivalente deve estar entre R$ 1 e R$ 100.000.');
      if(!available(getInvoice(row.id)))return res.status(409).json({error:'O pagamento já foi iniciado.'});
      const quote={id:randomUUID(),currency,minor:parsed.minor,digits,brl,...rate,expiresAt:new Date(Date.now()+600000).toISOString()};
      db.prepare('DELETE FROM donation_quotes WHERE expires_at<?').run(new Date().toISOString());
      db.prepare('INSERT INTO donation_quotes VALUES(?,?,?,?)').run(quote.id,row.id,JSON.stringify(quote),quote.expiresAt);
      res.json(quote);
    }catch(e){res.status(400).json({error:e.message});}
  });
  return function selectedQuote(row,id){
    if(id===undefined)return null;
    if(!row.allow_amount_edit || typeof id!=='string')throw new Error('Ajuste de valor não permitido.');
    const record=db.prepare('SELECT * FROM donation_quotes WHERE id=? AND invoice_id=?').get(id,row.id);
    if(!record || Date.parse(record.expires_at)<=Date.now())throw new Error('A estimativa expirou. Revise o valor novamente antes de pagar.');
    return JSON.parse(record.data);
  };
}
