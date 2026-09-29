import {bech32,bech32m} from 'bech32';
import QRCode from 'qrcode';
export const txPattern=/^[a-f0-9]{64}$/;
export function validBitcoinAddress(address){
 try{const codec=address.startsWith('bc1p')?bech32m:bech32;const decoded=codec.decode(address);const version=decoded.words[0], bytes=codec.fromWords(decoded.words.slice(1));return decoded.prefix==='bc' && ((version===0 && [20,32].includes(bytes.length)) || (version===1 && bytes.length===32));}catch{return false;}
}
export function satoshis(value){
 if(typeof value!=='string' || !/^(0|[1-9][0-9]{0,2})([.,][0-9]{1,8})?$/.test(value))throw new Error('Informe BTC com até 8 casas decimais.');
 const [whole,fraction='']=value.replace(',','.').split('.');const result=Number(whole)*100000000+Number(fraction.padEnd(8,'0'));
 if(result<1000 || result>10000000000)throw new Error('O valor deve estar entre 0,00001000 e 100 BTC.');return result;
}
export const btcString=amount=>(amount/100000000).toFixed(8);
export async function verifyBitcoin(row,txid,vout,fetcher=fetch){
 async function get(path,text=false){const r=await fetcher('https://blockstream.info/api/'+path,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error('Consulta Bitcoin indisponível. Confira o TXID e tente mais tarde.');return text?r.text():r.json();}
 const tx=await get('tx/'+txid), tip=Number(await get('blocks/tip/height',true));const output=tx.vout?.[vout];
 if(tx.txid!==txid || !output || output.scriptpubkey_address!==row.btc_address || !Number.isSafeInteger(output.value) || output.value<row.btc_sats)throw new Error('A saída informada não corresponde ao endereço e ao valor desta cobrança.');
 const status=tx.status;
 if(!status?.confirmed || !Number.isInteger(status.block_height) || !Number.isInteger(tip) || tip-status.block_height+1<3)throw new Error('Aguarde ao menos 3 confirmações na rede Bitcoin.');
 if(!Number.isInteger(status.block_time) || status.block_time*1000<Date.parse(row.created_at))throw new Error('A transação é anterior à cobrança.');
 if(!txPattern.test(status.block_hash || ''))throw new Error('Bloco inválido.');
 const block=await get('block/'+status.block_hash+'/status');if(block.in_best_chain!==true)throw new Error('Bloco fora da cadeia principal.');
 return {receivedSats:output.value,confirmations:tip-status.block_height+1};
}
export function installBitcoin(app,{db,env,mode,auth,exposed,getInvoice,available,payLimit,fetcher}){
 const address=env.BITCOIN_ADDRESS || '';
 if(address && !validBitcoinAddress(address))throw new Error('BITCOIN_ADDRESS inválido. Use endereço Bitcoin mainnet SegWit/Taproot.');
 const enabled=mode==='demo' || (mode==='production' && env.ENABLE_BITCOIN==='true' && Boolean(address));
 const columns=db.prepare('PRAGMA table_info(invoices)').all().map(c=>c.name);
 for(const [name,type] of Object.entries({btc_sats:'INTEGER',btc_address:'TEXT',btc_txid:'TEXT',btc_vout:'INTEGER',btc_received:'INTEGER',payment_method:"TEXT NOT NULL DEFAULT 'credit'"}))if(!columns.includes(name))db.exec(`ALTER TABLE invoices ADD COLUMN ${name} ${type}`);
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS bitcoin_outpoint ON invoices(btc_txid,btc_vout) WHERE btc_vout IS NOT NULL');
 app.post('/api/public/:id/bitcoin',payLimit,async(req,res)=>{
  const row=getInvoice(req.params.id);
  if(!row || !row.btc_sats || (!available(row) && !['bitcoin_pending','bitcoin_review'].includes(row.state)))return res.status(409).json({error:'Bitcoin não disponível nesta cobrança.'});
  if(!enabled)return res.status(409).json({error:'Bitcoin não habilitado neste ambiente.'});
  if(row.state==='open')db.prepare("UPDATE invoices SET state='bitcoin_pending',payment_method='bitcoin',btc_address=? WHERE id=? AND state='open'").run(mode==='demo'?null:address,row.id);
  const current=getInvoice(row.id);
  const uri=mode==='demo'?null:`bitcoin:${current.btc_address}?amount=${btcString(current.btc_sats)}&label=Essencia%20Viva`;
  res.json({invoice:exposed(current),address:mode==='demo'?null:current.btc_address,amount:btcString(current.btc_sats),uri,qr:uri?await QRCode.toDataURL(uri,{width:280,margin:3}):null});
 });
 app.post('/api/public/:id/bitcoin-report',payLimit,(req,res)=>{
  const row=getInvoice(req.params.id), txid=req.body?.txid;
  if(!row || !['bitcoin_pending','bitcoin_review'].includes(row.state))return res.status(409).json({error:'Cobrança não aguarda Bitcoin.'});
  if(!txPattern.test(txid || ''))return res.status(400).json({error:'Informe o TXID com 64 caracteres hexadecimais minúsculos.'});
  db.prepare("UPDATE invoices SET btc_txid=?,state='bitcoin_review' WHERE id=? AND state IN ('bitcoin_pending','bitcoin_review')").run(txid,row.id);
  res.json(exposed(getInvoice(row.id)));
 });
 app.post('/api/invoices/:id/bitcoin-confirm',auth,async(req,res)=>{
  const row=getInvoice(req.params.id),{txid,vout,verifiedWithDonor}=req.body || {};
  if(!row || !['bitcoin_pending','bitcoin_review'].includes(row.state))return res.status(409).json({error:'Cobrança não aguarda Bitcoin.'});
  if(verifiedWithDonor!==true || !txPattern.test(txid || '') || !Number.isInteger(vout) || vout<0 || vout>10000)return res.status(400).json({error:'Confira o doador, informe TXID e índice da saída (vout).'});
  try{
   const result=mode==='demo'?{receivedSats:row.btc_sats}:await verifyBitcoin(row,txid,vout,fetcher);
   // Compare state AND submitted TXID after asynchronous network work; no overwritten reports.
   const saved=db.prepare("UPDATE invoices SET state='paid',btc_txid=?,btc_vout=?,btc_received=?,checked_at=? WHERE id=? AND state=? AND btc_txid IS ?").run(txid,vout,result.receivedSats,new Date().toISOString(),row.id,row.state,row.btc_txid);
   if(!saved.changes)return res.status(409).json({error:'A cobrança mudou durante a conferência. Atualize a lista.'});
   res.json(exposed(getInvoice(row.id),true));
  }catch(e){res.status(400).json({error:e.code?.startsWith('ERR_SQLITE')?'Esta saída Bitcoin já foi usada em outra cobrança.':e.message});}
 });
 return {enabled};
}
