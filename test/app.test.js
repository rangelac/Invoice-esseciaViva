import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp, amountInCents, paymentState} from '../server.js';
import {cieloClient} from '../cielo.js';
import {invoiceValue} from '../invoice-money.js';
import {bech32m} from 'bech32';
import {validBitcoinAddress,satoshis,verifyBitcoin} from '../bitcoin.js';
import {readQuote} from '../currency.js';
import {rateClient} from '../donation-amount.js';
const password='test-only-password-123456789';
async function fixture(t,provider,mode='demo',extraEnv={},bitcoinFetch) {
 const {app,db}=createApp({ADMIN_PASSWORD:password,PAYMENT_MODE:mode,PUBLIC_URL:'http://localhost:3000',DB_PATH:':memory:',CIELO_MERCHANT_ID:'test',CIELO_MERCHANT_KEY:'test',CIELO_SOP_CLIENT_ID:'test',CIELO_SOP_CLIENT_SECRET:'test',...extraEnv},provider,bitcoinFetch);
 const server=app.listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 t.after(()=>{server.closeAllConnections();server.close();db.close();});
 const base=`http://127.0.0.1:${server.address().port}`;
 let cookie='';
 async function request(path,body,extra={}){return fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Essencia-Request':'1',Origin:extraEnv.PUBLIC_URL || 'http://localhost:3000',Cookie:cookie,...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 const login=await request('/api/login',{password});cookie=login.headers.get('set-cookie').split(';')[0];
 async function create(extra={}){const r=await request('/api/invoices',{name:'Doador Teste',email:'teste@example.com',description:'Apoio à ONG',amount:'125,90',dueDate:new Date(Date.now()+86400000).toISOString().slice(0,10),requestKey:randomUUID(),...extra});return {response:r,invoice:await r.json()};}
 return {request,create,db,base};
}
test('valores monetários são exatos e rejeitam entradas ambíguas',()=>{assert.equal(amountInCents('125,90'),12590);assert.equal(amountInCents('1.1'),110);for(const v of ['0','-5','1e3','1.234,56','NaN','100000.01',1,null])assert.throws(()=>amountInCents(v));assert.equal(paymentState(1),'authorized');assert.equal(paymentState(2),'paid');assert.equal(paymentState(12),'review');});
test('proteção de sessão, origem e dados privados',async t=>{const f=await fixture(t);assert.equal((await fetch(f.base+'/api/invoices')).status,401);assert.equal((await f.request('/api/invoices',{}, {Origin:'https://evil.test'})).status,403);const {invoice}=await f.create();const publicData=await (await f.request('/api/public/'+invoice.id)).json();assert.equal(publicData.name,undefined);assert.equal(publicData.email,undefined);assert.equal(publicData.orderId,undefined);await f.request('/api/logout',{});assert.equal((await f.request('/api/invoices')).status,401);});
test('criação idempotente e pagamento demo único mesmo em concorrência',async t=>{const f=await fixture(t);const requestKey=randomUUID();const a=await f.create({requestKey});const b=await f.create({requestKey});assert.equal(a.invoice.id,b.invoice.id);const results=await Promise.all([f.request(`/api/public/${a.invoice.id}/pay`,{demo:true}),f.request(`/api/public/${a.invoice.id}/pay`,{demo:true})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal((await (await f.request('/api/public/'+a.invoice.id)).json()).state,'paid');});
test('expiração e rejeição de cartão bruto ou alteração de valor',async t=>{const f=await fixture(t);const {invoice}=await f.create();assert.equal((await f.request(`/api/public/${invoice.id}/pay`,{demo:true,amount:1})).status,400);assert.equal((await f.request(`/api/public/${invoice.id}/pay`,{demo:true,CardNumber:'4111111111111111'})).status,400);f.db.prepare('UPDATE invoices SET expires_at=? WHERE id=?').run('2020-01-01T00:00:00Z',invoice.id);assert.equal((await f.request(`/api/public/${invoice.id}/pay`,{demo:true})).status,409);assert.equal((await (await f.request('/api/public/'+invoice.id)).json()).state,'expired');});
test('falha incerta bloqueia novas tentativas e concilia pelo pedido',async t=>{let calls=0,order;const paymentId=randomUUID();const f=await fixture(t,{async create(i){calls++;order=i;throw new Error('timeout');},async find(id){assert.equal(id,order.order_id);return {Payments:[{PaymentId:paymentId}]};},async query(){return {MerchantOrderId:order.order_id,Payment:{PaymentId:paymentId,Amount:order.amount,Type:'CreditCard',Status:2}};}},'sandbox');const {invoice}=await f.create();const path=`/api/public/${invoice.id}/pay`;const body={paymentToken:randomUUID(),brand:'Visa'};assert.equal((await f.request(path,body)).status,202);assert.equal((await f.request(path,body)).status,409);assert.equal(calls,1);const result=await (await f.request(`/api/invoices/${invoice.id}/refresh`,{})).json();assert.equal(result.state,'paid');});
test('resposta divergente não confirma pagamento',async t=>{const f=await fixture(t,{async create(i){return {MerchantOrderId:i.order_id,Payment:{PaymentId:randomUUID(),Amount:1,Type:'CreditCard',Status:2}};}},'sandbox');const {invoice}=await f.create();const result=await (await f.request(`/api/public/${invoice.id}/pay`,{paymentToken:randomUUID(),brand:'Visa'})).json();assert.equal(result.state,'review');});
test('autorização sem captura não é tratada como paga',async t=>{const f=await fixture(t,{async create(i){return {MerchantOrderId:i.order_id,Payment:{PaymentId:randomUUID(),Amount:i.amount,Type:'CreditCard',Status:1}};}},'sandbox');const {invoice}=await f.create();const result=await (await f.request(`/api/public/${invoice.id}/pay`,{paymentToken:randomUUID(),brand:'Master'})).json();assert.equal(result.state,'authorized');});
test('produção exige HTTPS, ativação e credenciais completas',()=>{assert.throws(()=>createApp({ADMIN_PASSWORD:password,PAYMENT_MODE:'production',DB_PATH:':memory:'}));assert.throws(()=>createApp({ADMIN_PASSWORD:password,PAYMENT_MODE:'sandbox',DB_PATH:':memory:'}));});
test('adaptador usa token e valor persistido nos endpoints oficiais',async()=>{const requests=[];const client=cieloClient({PAYMENT_MODE:'sandbox',CIELO_MERCHANT_ID:'merchant',CIELO_MERCHANT_KEY:'secret',CIELO_SOP_CLIENT_ID:'id',CIELO_SOP_CLIENT_SECRET:'secret'},async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url.includes('oauth2')?{access_token:'oauth'}:url.includes('accesstoken')?{AccessToken:'sop'}:{}};});assert.equal((await client.sop()).accessToken,'sop');await client.create({order_id:'abc',amount:15000,name:'Teste'},'token','Visa');await client.query('payment');const sale=requests[2];assert.equal(sale.url,'https://apisandbox.cieloecommerce.cielo.com.br/v2/sales/');const body=JSON.parse(sale.options.body);assert.equal(body.Payment.Amount,15000);assert.equal(body.Payment.Capture,true);assert.deepEqual(body.Payment.CreditCard,{PaymentToken:'token',Brand:'Visa'});assert.match(requests[3].url,/apiquerysandbox/);});

test('demo oferece moeda, exige escolha válida e impede dupla confirmação',async t=>{
 const f=await fixture(t);const {invoice}=await f.create();
 const offer=await (await f.request(`/api/public/${invoice.id}/pay`,{demo:true,demoCurrency:'EUR'})).json();
 assert.equal(offer.state,'currency_choice');assert.equal(offer.quote.exchanges[0].currency,'EUR');assert.equal(offer.chosenCurrency,null);
 const endpoint=`/api/public/${invoice.id}/confirm-currency`;
 assert.equal((await f.request(endpoint,{currency:'USD'})).status,400);
 assert.equal((await f.request(endpoint,{currency:'EUR',amount:1})).status,400);
 const responses=await Promise.all([f.request(endpoint,{currency:'EUR'}),f.request(endpoint,{currency:'BRL'})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const paid=await (await f.request('/api/public/'+invoice.id)).json();assert.equal(paid.state,'paid');assert.equal(paid.chosenCurrency,'EUR');assert.equal(paid.amount,12590);assert.equal(paid.currency,'BRL');assert.ok(paid.choiceAt);
});
test('cotação expirada nunca é confirmada nem renovada por recarga',async t=>{
 const f=await fixture(t);const {invoice}=await f.create();await f.request(`/api/public/${invoice.id}/pay`,{demo:true,demoCurrency:'USD'});
 const row=f.db.prepare('SELECT quote_json FROM invoices WHERE id=?').get(invoice.id);const quote=JSON.parse(row.quote_json);quote.expiresAt='2020-01-01T00:00:00Z';f.db.prepare('UPDATE invoices SET quote_json=? WHERE id=?').run(JSON.stringify(quote),invoice.id);
 assert.equal((await f.request(`/api/public/${invoice.id}/confirm-currency`,{currency:'BRL'})).status,409);
 assert.equal((await (await f.request('/api/public/'+invoice.id)).json()).state,'quote_expired');
});
test('valores convertidos usam precisão da moeda e cotação coerente',()=>{
 for(const [currency,converted,rate,digits] of [['JPY',3000,30,0],['KWD',6100,.061,3],['USD',2000,.2,2]]){
  const quote=readQuote({CurrencyExchangeData:{CurrencyExchanges:[{Currency:currency,ConvertedAmount:converted,ConversionRate:rate}]}},10000,new Date().toISOString());assert.equal(quote.exchanges[0].digits,digits);
 }
 assert.throws(()=>readQuote({CurrencyExchangeData:{CurrencyExchanges:[{Currency:'USD',ConvertedAmount:999,ConversionRate:.2}]}},10000,new Date().toISOString()));
});
function dccProvider({empty=false,fail=false}={}){
 let invoice;const id=randomUUID();const confirmations=[];
 return {confirmations,async create(row){invoice=row;assert.equal(row.dcc_requested,1);return {MerchantOrderId:row.order_id,Payment:{PaymentId:id,Amount:row.amount,Type:'CreditCard',Status:12,CurrencyExchangeData:{CurrencyExchanges:empty?[]:[{Currency:'USD',ConvertedAmount:Math.round(row.amount*.2),ConversionRate:.2}]}}};},async confirm(paymentId,convert){assert.equal(paymentId,id);confirmations.push(convert);if(fail)throw new Error('timeout');return {Status:2};},async query(){return {MerchantOrderId:invoice.order_id,Payment:{PaymentId:id,Amount:invoice.amount,Type:'CreditCard',Status:2}};}};
}
test('DCC confirma escolha estrangeira ou BRL com consulta independente',async t=>{
 for(const currency of ['USD','BRL']) {const provider=dccProvider();const f=await fixture(t,provider,'sandbox',{CIELO_DCC_ENABLED:'true'});const {invoice}=await f.create();await f.request(`/api/public/${invoice.id}/pay`,{paymentToken:randomUUID(),brand:'Visa'});const result=await (await f.request(`/api/public/${invoice.id}/confirm-currency`,{currency})).json();assert.equal(result.state,'paid');assert.deepEqual(provider.confirmations,[currency!=='BRL']);}
});
test('cartão sem oferta de conversão mantém opção em BRL',async t=>{
 const provider=dccProvider({empty:true});const f=await fixture(t,provider,'sandbox',{CIELO_DCC_ENABLED:'true'});const {invoice}=await f.create();const offer=await (await f.request(`/api/public/${invoice.id}/pay`,{paymentToken:randomUUID(),brand:'Master'})).json();assert.equal(offer.state,'currency_choice');assert.deepEqual(offer.quote.exchanges,[]);const result=await (await f.request(`/api/public/${invoice.id}/confirm-currency`,{currency:'BRL'})).json();assert.equal(result.state,'paid');assert.deepEqual(provider.confirmations,[false]);
});
test('timeout de confirmação guarda a escolha sem reenviar e permite conciliar',async t=>{
 const provider=dccProvider({fail:true});const f=await fixture(t,provider,'sandbox',{CIELO_DCC_ENABLED:'true'});const {invoice}=await f.create();await f.request(`/api/public/${invoice.id}/pay`,{paymentToken:randomUUID(),brand:'Visa'});const path=`/api/public/${invoice.id}/confirm-currency`;const result=await (await f.request(path,{currency:'USD'})).json();assert.equal(result.state,'review');assert.equal(result.chosenCurrency,'USD');assert.equal((await f.request(path,{currency:'USD'})).status,409);const reconciled=await (await f.request(`/api/invoices/${invoice.id}/refresh`,{})).json();assert.equal(reconciled.state,'paid');assert.equal(reconciled.chosenCurrency,'USD');assert.equal(provider.confirmations.length,1);
});
test('adaptador DCC solicita conversão e confirma com booleano, sem receber câmbio do navegador',async()=>{
 const requests=[];const client=cieloClient({PAYMENT_MODE:'production'},async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>({})};});await client.create({order_id:'abc',name:'Doador',amount:10000,dcc_requested:1},'token','Visa');assert.equal(JSON.parse(requests[0].options.body).Payment.DynamicCurrencyConversion,true);await client.confirm('id',false);assert.equal(requests[1].url,'https://api.cieloecommerce.cielo.com.br/1/sales/id/confirm');assert.deepEqual(JSON.parse(requests[1].options.body),{CurrencyConversion:false});
});

test('fatura estrangeira exige equivalente em BRL explícito',async t=>{const f=await fixture(t);assert.equal((await f.create({currency:'USD'})).response.status,400);});
test('conferência de cotação expirada consulta a Cielo sem renovar oferta',async t=>{
 const provider=dccProvider();const f=await fixture(t,provider,'sandbox',{CIELO_DCC_ENABLED:'true'});const {invoice}=await f.create();await f.request(`/api/public/${invoice.id}/pay`,{paymentToken:randomUUID(),brand:'Visa'});const row=f.db.prepare('SELECT quote_json FROM invoices WHERE id=?').get(invoice.id);const quote=JSON.parse(row.quote_json);quote.expiresAt='2020-01-01T00:00:00Z';f.db.prepare('UPDATE invoices SET quote_json=? WHERE id=?').run(JSON.stringify(quote),invoice.id);const result=await (await f.request(`/api/invoices/${invoice.id}/refresh`,{})).json();assert.equal(result.state,'paid');assert.equal(result.quote.expiresAt,'2020-01-01T00:00:00Z');assert.equal(provider.confirmations.length,0);
});

const btcAddress=bech32m.encode('bc',[1,...bech32m.toWords(new Uint8Array(32).fill(1))]);
test('Bitcoin valida checksum, rede e satoshis sem arredondar',()=>{assert.equal(validBitcoinAddress(btcAddress),true);assert.equal(validBitcoinAddress(btcAddress.slice(0,-1)+'x'),false);assert.equal(validBitcoinAddress('0xb505848f20D3776055100E943d5818b01AC59C47'),false);assert.equal(satoshis('0,00001001'),1001);for(const v of ['0.000000001','-1','1e-4','0.00000001'])assert.throws(()=>satoshis(v));});
test('Bitcoin demo oculta endereço real, bloqueia cartão e exige baixa administrativa',async t=>{
 const f=await fixture(t,undefined,'demo',{BITCOIN_ADDRESS:btcAddress});const {invoice}=await f.create({bitcoinAmount:'0.0001'});const endpoint=`/api/public/${invoice.id}`;
 const selected=await (await f.request(endpoint+'/bitcoin',{})).json();assert.equal(selected.address,null);assert.equal(selected.qr,null);assert.equal(selected.invoice.state,'bitcoin_pending');assert.equal((await f.request(endpoint+'/pay',{demo:true})).status,409);
 const txid='a'.repeat(64);const reported=await (await f.request(endpoint+'/bitcoin-report',{txid})).json();assert.equal(reported.state,'bitcoin_review');assert.equal((await f.request(`/api/invoices/${invoice.id}/bitcoin-confirm`,{txid,vout:0})).status,400);
 const paid=await (await f.request(`/api/invoices/${invoice.id}/bitcoin-confirm`,{txid,vout:0,verifiedWithDonor:true})).json();assert.equal(paid.state,'paid');assert.equal(paid.paymentMethod,'bitcoin');
 const second=(await f.create({bitcoinAmount:'0.0001'})).invoice;await f.request(`/api/public/${second.id}/bitcoin`,{});assert.equal((await f.request(`/api/invoices/${second.id}/bitcoin-confirm`,{txid,vout:0,verifiedWithDonor:true})).status,400);
});
test('Bitcoin não pode ser selecionado sem valor BTC e não substitui cartão já iniciado',async t=>{const f=await fixture(t);const a=(await f.create()).invoice;assert.equal((await f.request(`/api/public/${a.id}/bitcoin`,{})).status,409);const b=(await f.create({bitcoinAmount:'0.001'})).invoice;await f.request(`/api/public/${b.id}/pay`,{demo:true});assert.equal((await f.request(`/api/public/${b.id}/bitcoin`,{})).status,409);});
test('verificação da rede exige saída correta, valor, confirmações e bloco válido',async()=>{
 const txid='a'.repeat(64), row={btc_address:btcAddress,btc_sats:10000,created_at:'2026-01-01T00:00:00Z'};
 const tx={txid,vout:[{scriptpubkey_address:btcAddress,value:10000}],status:{confirmed:true,block_height:100,block_time:1780000000,block_hash:'b'.repeat(64)}};
 let tip=102,inChain=true;
 const fetcher=async url=>({ok:true,json:async()=>url.includes('/tx/')?tx:{in_best_chain:inChain},text:async()=>String(tip)});
 assert.equal((await verifyBitcoin(row,txid,0,fetcher)).confirmations,3);
 tip=101;await assert.rejects(verifyBitcoin(row,txid,0,fetcher));tip=102;tx.vout[0].value=9999;await assert.rejects(verifyBitcoin(row,txid,0,fetcher));tx.vout[0].value=10000;inChain=false;await assert.rejects(verifyBitcoin(row,txid,0,fetcher));inChain=true;tx.vout[0].scriptpubkey_address='other';await assert.rejects(verifyBitcoin(row,txid,0,fetcher));
});

test('Bitcoin produção emite QR e só confirma após verificação da rede e do administrador',async t=>{
 const txid='c'.repeat(64),mockFetch=async url=>({ok:true,text:async()=> '102',json:async()=>url.includes('/tx/')?{txid,vout:[{scriptpubkey_address:btcAddress,value:10000}],status:{confirmed:true,block_height:100,block_time:Math.floor(Date.now()/1000)+60,block_hash:'d'.repeat(64)}}:{in_best_chain:true}});
 const f=await fixture(t,undefined,'production',{PUBLIC_URL:'https://example.test',ENABLE_LIVE_PAYMENTS:'true',ENABLE_BITCOIN:'true',BITCOIN_ADDRESS:btcAddress},mockFetch);
 const {invoice}=await f.create({bitcoinAmount:'0.0001'});const selected=await (await f.request(`/api/public/${invoice.id}/bitcoin`,{})).json();assert.equal(selected.address,btcAddress);assert.match(selected.qr,/^data:image\/png;base64,/);assert.equal(selected.uri,`bitcoin:${btcAddress}?amount=0.00010000&label=Essencia%20Viva`);
 const paid=await (await f.request(`/api/invoices/${invoice.id}/bitcoin-confirm`,{txid,vout:0,verifiedWithDonor:true})).json();assert.equal(paid.state,'paid');assert.equal(paid.bitcoinTxid,txid);
});

test('fatura conserva moeda e valor originais e cobra apenas o equivalente BRL',async t=>{
 const f=await fixture(t);const {response,invoice}=await f.create({currency:'EUR',amount:'100.25',equivalentBrl:'601.50',billingAddress:'Rua Exemplo, 10\nLisboa, Portugal'});assert.equal(response.status,201);assert.equal(invoice.invoiceCurrency,'EUR');assert.equal(invoice.invoiceAmount,10025);assert.equal(invoice.amount,60150);assert.match(invoice.number,/^EV-[0-9]+$/);assert.equal(invoice.dccEnabled,false);
 const pub=await (await f.request('/api/public/'+invoice.id)).json();assert.equal(pub.invoiceCurrency,'EUR');assert.equal(pub.billingAddress,undefined);assert.equal(pub.name,undefined);assert.equal((await f.request(`/api/public/${invoice.id}/pay`,{demo:true,demoCurrency:'EUR'})).status,400);
 assert.equal((await (await f.request(`/api/public/${invoice.id}/pay`,{demo:true})).json()).state,'paid');
});
test('precisão por moeda, incluindo zero, três e oito casas',()=>{assert.deepEqual(invoiceValue('1200','JPY'),{minor:1200,digits:0});assert.deepEqual(invoiceValue('1.234','KWD'),{minor:1234,digits:3});assert.deepEqual(invoiceValue('0.00001001','BTC'),{minor:1001,digits:8});assert.throws(()=>invoiceValue('12.50','JPY'));assert.throws(()=>invoiceValue('0.001','EUR'));assert.throws(()=>invoiceValue('100','INVALID'));});
test('fatura BTC define valor principal e mantém equivalente para cartão',async t=>{const f=await fixture(t);const {invoice}=await f.create({currency:'BTC',amount:'0.0001',equivalentBrl:'50.00'});assert.equal(invoice.invoiceAmount,10000);assert.equal(invoice.bitcoinAmount,10000);assert.equal(invoice.amount,5000);assert.equal(invoice.invoiceDigits,8);});
test('PDF está disponível na emissão, com autenticação na versão completa',async t=>{const f=await fixture(t);const {invoice}=await f.create({currency:'USD',amount:'100',equivalentBrl:'500'});const path=`/api/invoices/${invoice.id}/pdf`;assert.equal((await fetch(f.base+path)).status,401);const pdf=await f.request(path);assert.equal(pdf.status,200);assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.match(pdf.headers.get('content-disposition'),/Fatura-EV-/);assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0,5).toString(),'%PDF-');assert.equal((await f.request(`/api/public/${invoice.id}/pdf`)).status,200);});


test('ajuste é opt-in; limites, precisão e proteção contra campos arbitrários',async t=>{
 const f=await fixture(t);const fixed=(await f.create()).invoice;
 assert.equal((await f.request(`/api/public/${fixed.id}/donation-quote`,{currency:'USD',value:'1000'})).status,409);
 const i=(await f.create({allowAmountEdit:true})).invoice;const path=`/api/public/${i.id}/donation-quote`;
 for(const body of [{currency:'USD',value:'0'},{currency:'USD',value:'25000'},{currency:'JPY',value:'2.01'},{currency:'USD',value:'10',rate:1},{currency:'BTC',value:'1'}])assert.equal((await f.request(path,body)).status,400);
 const quote=await (await f.request(path,{currency:'USD',value:'1000'})).json();assert.equal(quote.brl,500000);assert.equal(quote.minor,100000);
 assert.equal((await f.request(`/api/public/${fixed.id}/pay`,{demo:true,amountQuoteId:quote.id})).status,400);
});

test('cotação vinculada à fatura, vencimento e rejeição de valor forjado',async t=>{
 const f=await fixture(t);const a=(await f.create({allowAmountEdit:true})).invoice,b=(await f.create({allowAmountEdit:true})).invoice;
 const quote=await (await f.request(`/api/public/${a.id}/donation-quote`,{currency:'USD',value:'1000'})).json();
 assert.equal((await f.request(`/api/public/${b.id}/pay`,{demo:true,amountQuoteId:quote.id})).status,400);
 assert.equal((await f.request(`/api/public/${a.id}/pay`,{demo:true,amountQuoteId:quote.id,amount:1})).status,400);
 f.db.prepare('UPDATE donation_quotes SET expires_at=? WHERE id=?').run('2020-01-01T00:00:00Z',quote.id);
 assert.equal((await f.request(`/api/public/${a.id}/pay`,{demo:true,amountQuoteId:quote.id})).status,400);
 assert.equal((await (await f.request(`/api/public/${a.id}`)).json()).state,'open');
});

test('valor ajustado persiste, conserva original, concilia com Cielo e impede duplicidade',async t=>{
 let submitted,calls=0;const f=await fixture(t,{async create(row){submitted=row;calls++;return {MerchantOrderId:row.order_id,Payment:{PaymentId:randomUUID(),Amount:row.payment_amount,Type:'CreditCard',Status:2}};}},'sandbox');
 const i=(await f.create({allowAmountEdit:true})).invoice;
 const q=await (await f.request(`/api/public/${i.id}/donation-quote`,{currency:'BRL',value:'25.00'})).json();
 const body={amountQuoteId:q.id,paymentToken:randomUUID(),brand:'Visa'};
 const responses=await Promise.all([f.request(`/api/public/${i.id}/pay`,body),f.request(`/api/public/${i.id}/pay`,body)]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(calls,1);assert.equal(submitted.payment_amount,2500);assert.equal(submitted.amount,12590);
 const final=await (await f.request(`/api/public/${i.id}`)).json();assert.equal(final.state,'paid');assert.equal(final.amount,2500);assert.equal(final.originalAmount,12590);assert.equal(final.invoiceAmount,12590);assert.equal(final.donation.minor,2500);
 assert.equal((await f.request(`/api/public/${i.id}/donation-quote`,{currency:'BRL',value:'1'})).status,409);
});

test('DCC usa valor ajustado e recusa alteração após iniciar',async t=>{
 const f=await fixture(t);const i=(await f.create({allowAmountEdit:true})).invoice;
 const q=await (await f.request(`/api/public/${i.id}/donation-quote`,{currency:'USD',value:'1000'})).json();
 const offered=await (await f.request(`/api/public/${i.id}/pay`,{demo:true,demoCurrency:'USD',amountQuoteId:q.id})).json();
 assert.equal(offered.state,'currency_choice');assert.equal(offered.amount,500000);assert.equal(offered.invoiceAmount,12590);
 assert.equal((await f.request(`/api/public/${i.id}/donation-quote`,{currency:'BRL',value:'1'})).status,409);
 assert.equal((await f.request(`/api/public/${i.id}/confirm-currency`,{currency:'USD',amountQuoteId:q.id})).status,400);
 assert.equal((await (await f.request(`/api/public/${i.id}/confirm-currency`,{currency:'USD'})).json()).state,'paid');
});

test('fonte de câmbio valida data e moeda, usa cache e não substitui falha por câmbio fictício',async()=>{
 let calls=0;const client=rateClient('production',async()=>{calls++;return {ok:true,json:async()=>({base:'USD',quote:'BRL',rate:5.2,date:new Date().toISOString().slice(0,10)})};});
 assert.equal((await client('USD')).rate,5.2);await client('USD');assert.equal(calls,1);
 for(const data of [{base:'EUR',quote:'BRL',rate:5,date:new Date().toISOString().slice(0,10)},{base:'USD',quote:'BRL',rate:5,date:'2020-01-01'},{base:'USD',quote:'BRL',rate:-1,date:new Date().toISOString().slice(0,10)}])await assert.rejects(rateClient('production',async()=>({ok:true,json:async()=>data}))('USD'));
 await assert.rejects(rateClient('production',async()=>({ok:false}))('USD'));
});

test('adaptador Cielo transmite o valor ajustado persistido',async()=>{
 let body;const client=cieloClient({PAYMENT_MODE:'production'},async(url,options)=>{body=JSON.parse(options.body);return {ok:true,json:async()=>({})};});
 await client.create({order_id:'x',name:'Teste',amount:12590,payment_amount:500000},randomUUID(),'Visa');assert.equal(body.Payment.Amount,500000);
});
