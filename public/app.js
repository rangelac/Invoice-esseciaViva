import {api,money,date,labels,element,invoiceMoney} from './shared.js';
const $=s=>document.querySelector(s);
let invoices=[], requestKey, toastTimer, bitcoinInvoice;
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function loginView(){ $('#login').hidden=false;$('#dashboard').hidden=true; }
async function load(){
  try {const result=await api('/api/invoices');invoices=result.invoices;fillCurrencies(result.currencies);$('#login').hidden=true;$('#dashboard').hidden=false;$('#environment').textContent={demo:'Demonstração',sandbox:'Ambiente de teste',production:'Pagamentos reais'}[result.mode];$('#demo-notice').hidden=result.mode!=='demo';render();}
  catch(e){if(e.status===401)loginView();else toast(e.message);}
}
function render(){
  $('#total-paid').textContent=money(invoices.filter(i=>i.state==='paid').reduce((n,i)=>n+i.amount,0));
  $('#total-open').textContent=money(invoices.filter(i=>['open','currency_choice','bitcoin_pending','bitcoin_review'].includes(i.state)).reduce((n,i)=>n+i.amount,0));
  $('#total-count').textContent=invoices.length;$('#list-count').textContent=invoices.length;
  $('#count-caption').textContent=invoices.length?`${invoices.filter(i=>i.state==='paid').length} contribuições confirmadas`:'Sua rede de apoio começa aqui';
  const search=$('#search').value.toLocaleLowerCase('pt-BR'), filter=$('#filter').value;
  const rows=invoices.filter(i=>(filter==='all'||i.state===filter)&&`${i.name} ${i.description}`.toLocaleLowerCase('pt-BR').includes(search));
  $('#rows').replaceChildren();$('#empty').hidden=rows.length>0;
  $('#empty h3').textContent=invoices.length?'Nenhuma cobrança encontrada.':'O próximo gesto começa aqui.';
  $('#empty p').textContent=invoices.length?'Tente outro nome ou ajuste o filtro.':'Crie sua primeira cobrança e compartilhe o link com um doador.';
  $('#first-invoice').hidden=invoices.length>0;
  for(const i of rows){const tr=element('tr'), who=element('td');who.append(element('strong',i.name),element('small',i.description));const status=element('td');status.append(element('span',labels[i.state]||i.state,`badge ${i.state}`));const actions=element('td');const share=element('button','Compartilhar ↗','secondary');share.onclick=()=>showShare(i);const refresh=element('button',i.paymentMethod==='bitcoin'?'Conferir Bitcoin':'Consultar Cielo','secondary');refresh.disabled=['open','expired'].includes(i.state)||(i.paymentMethod==='bitcoin'&&i.state==='paid');refresh.onclick=async()=>{if(i.paymentMethod==='bitcoin'){showBitcoin(i);return;}refresh.disabled=true;try{await api(`/api/invoices/${i.id}/refresh`,{});await load();toast('Situação atualizada.');}catch(e){toast(e.message);refresh.disabled=false;}};const pdf=element('a','PDF ↓','secondary');pdf.href=`/api/invoices/${i.id}/pdf`;pdf.download=`Fatura-${i.number}.pdf`;actions.append(share,pdf,refresh);const amountCell=element('td',invoiceMoney(i));if(i.donation)amountCell.append(element('small','Escolhido: '+new Intl.NumberFormat('pt-BR',{style:'currency',currency:i.donation.currency}).format(i.donation.minor/10**i.donation.digits)),element('small','Cartão: '+money(i.amount)));tr.append(who,amountCell,element('td',date(i.expiresAt)),status,actions);$('#rows').append(tr);}
}
function openForm(){requestKey=crypto.randomUUID();$('#create-form').reset();syncCurrency();$('#create-error').textContent='';const now=new Date();const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Rio_Branco',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);$('[name=dueDate]').min=localDate;now.setDate(now.getDate()+7);$('[name=dueDate]').value=now.toISOString().slice(0,10);$('#create-dialog').showModal();}
function showShare(i){$('#share-link').value=i.url;$('#open-share').href=i.url;$('#download-share').href=`/api/invoices/${i.id}/pdf`;$('#download-share').download=`Fatura-${i.number}.pdf`;$('#share-dialog').showModal();}
$('#login-form').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button');button.disabled=true;try{await api('/api/login',{password:new FormData(e.currentTarget).get('password')});$('#login-form').reset();$('#login-error').textContent='';await load();}catch(e){$('#login-error').textContent=e.message;}finally{button.disabled=false;}};
$('#create-form').onsubmit=async e=>{e.preventDefault();$('#create-submit').disabled=true;$('#create-error').textContent='';try{const invoice=await api('/api/invoices',{...Object.fromEntries(new FormData(e.currentTarget)),allowAmountEdit:e.currentTarget.elements.allowAmountEdit.checked,requestKey});$('#create-dialog').close();await load();showShare(invoice);}catch(e){$('#create-error').textContent=e.message;}finally{$('#create-submit').disabled=false;}};
$('#copy-share').onclick=async()=>{try{await navigator.clipboard.writeText($('#share-link').value);toast('Link copiado. Pronto para compartilhar!');}catch{$('#share-link').select();toast('Selecione e copie o link acima.');}};
$('#new-invoice').onclick=openForm;$('#first-invoice').onclick=openForm;$('#close-dialog').onclick=()=>$('#create-dialog').close();$('#close-share').onclick=()=>$('#share-dialog').close();$('#search').oninput=render;$('#filter').onchange=render;$('#reload').onclick=load;$('#logout').onclick=async()=>{try{await api('/api/logout',{});invoices=[];loginView();}catch(e){toast(e.message);}};
load();

function showBitcoin(i){bitcoinInvoice=i;$('#bitcoin-confirm-form').reset();$('#bitcoin-summary').textContent=`${i.name} · ${(i.bitcoinAmount/1e8).toFixed(8)} BTC · referência ${money(i.amount)}${i.mode==='demo'?' · SIMULAÇÃO, sem consulta à rede':''}`;$('#bitcoin-confirm-form [name=txid]').value=i.bitcoinTxid || '';$('#bitcoin-admin-error').textContent='';$('#bitcoin-dialog').showModal();}
$('#close-bitcoin').onclick=()=>$('#bitcoin-dialog').close();
$('#bitcoin-confirm-form').onsubmit=async e=>{e.preventDefault();const button=e.currentTarget.querySelector('button.primary');button.disabled=true;const data=new FormData(e.currentTarget);try{await api(`/api/invoices/${bitcoinInvoice.id}/bitcoin-confirm`,{txid:data.get('txid'),vout:Number(data.get('vout')),verifiedWithDonor:data.get('verified')==='on'});$('#bitcoin-dialog').close();await load();toast('Recebimento confirmado.');}catch(e){$('#bitcoin-admin-error').textContent=e.message;}finally{button.disabled=false;}};

function fillCurrencies(currencies){if(!currencies || $('#invoice-currency').options.length>1)return;const names=new Intl.DisplayNames(['pt-BR'],{type:'currency'});for(const code of currencies.filter(c=>c!=='BRL')){const option=element('option',code+' - '+(code==='BTC'?'Bitcoin':names.of(code)));option.value=code;$('#invoice-currency').append(option);}}
function syncCurrency(){const code=$('#invoice-currency').value;$('#amount-label').textContent='Valor da fatura ('+code+')';const digits=code==='BTC'?8:new Intl.NumberFormat('pt-BR',{style:'currency',currency:code}).resolvedOptions().maximumFractionDigits;$('[name=amount]').pattern='[0-9]{1,9}'+(digits?'([.,][0-9]{1,'+digits+'})?':'');$('#equivalent-label').hidden=code==='BRL';$('[name=equivalentBrl]').disabled=code==='BRL';$('[name=equivalentBrl]').required=code!=='BRL';$('#bitcoin-alternative-label').hidden=code==='BTC';$('[name=bitcoinAmount]').disabled=code==='BTC';}
$('#invoice-currency').onchange=syncCurrency;
