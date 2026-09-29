import {api,money,date,element,foreignMoney} from './shared.js';
const $=s=>document.querySelector(s), id=location.pathname.split('/').pop(), base='/api/public/'+encodeURIComponent(id);
let invoice, scriptReady, sending=false;
function message(text,error=false){$('#payment-message').textContent=text;$('#payment-message').className='payment-message'+(error?' error':'');$('#payment-message').hidden=false;}
function render(i){invoice=i;$('#description').textContent=i.description;$('#amount').textContent=money(i.amount);$('#due').textContent='Disponível até '+date(i.expiresAt);$('#pay-mode').textContent={demo:'Demonstração',sandbox:'Ambiente de teste',production:'Doação por cartão'}[i.mode];const open=i.state==='open';$('#pay-form').hidden=!open||i.mode==='demo';$('#demo-box').hidden=!open||i.mode!=='demo';$('#check-status').hidden=open;$('#payment-message').hidden=open;
 renderCurrency(i);
 $('#dcc-notice').hidden=!open || !i.dccEnabled;
 const messages={currency_choice:'Seu cartão foi verificado. Escolha a moeda abaixo para concluir.',quote_expired:'A cotação de câmbio expirou. Não realize outro pagamento antes da conferência pela organização.',paid:i.mode==='demo'?'Doação simulada com sucesso! Nenhuma cobrança foi realizada.':'Doação confirmada. Obrigado por fazer parte da Essência Viva! ♡',review:'Estamos conferindo seu pagamento. Não tente pagar novamente. A organização verificará a situação na Cielo.',processing:'Seu pagamento está sendo processado. Aguarde a confirmação.',authorized:'Pagamento autorizado, aguardando confirmação de captura. A organização verificará a situação na Cielo.',declined:'O pagamento foi recusado. Entre em contato com a organização para receber uma nova cobrança.',expired:'Esta cobrança venceu. Solicite um novo link à organização.',cancelled:'Esta cobrança foi cancelada.',refunded:'O pagamento foi estornado.'};if(!open)message(messages[i.state]||'Pagamento em conferência.');
 $('#pay-button').textContent=i.dccEnabled && ['Visa','Master'].includes($('#brand').value)?'Continuar para pagamento':'Doar '+money(i.amount);}
async function load(){try{render(await api(base));}catch(e){$('#pay-form').hidden=true;$('#demo-box').hidden=true;message(e.message,true);}}
function loadScript(environment){if(scriptReady)return scriptReady;scriptReady=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=environment==='production'?'https://transactionscus.pagador.com.br/post/Scripts/silentorderpost-1.0.min.js':'https://transactionsandbox.pagador.com.br/post/Scripts/silentorderpost-1.0.min.js';s.onload=resolve;s.onerror=()=>{scriptReady=null;s.remove();reject(new Error('Não foi possível carregar o serviço de cartão.'));};document.head.append(s);});return scriptReady;}
async function pay(data){try{const result=await api(base+'/pay',data);render(result);}catch(e){await load();message(e.message,true);}finally{sending=false;$('#pay-button').disabled=false;$('#demo-pay').disabled=false;$('#demo-foreign').disabled=false;}}
$('#demo-pay').onclick=()=>{if(sending)return;sending=true;$('#demo-pay').disabled=true;pay({demo:true});};
$('#pay-form').onsubmit=async e=>{e.preventDefault();if(sending)return;sending=true;$('#pay-button').disabled=true;$('#payment-message').hidden=true;
 try{const config=await api(base+'/sop',{});await loadScript(config.environment);await new Promise((resolve,reject)=>{window.bpSop_silentOrderPost({accessToken:config.accessToken,environment:config.environment,language:'pt',enableBinQuery:false,enableVerifyCard:false,enableTokenize:false,cvvRequired:true,cvvrequired:true,cardType:'creditCard',onSuccess:async response=>{const brand=$('#brand').value;$('#pay-form').reset();await pay({paymentToken:response.PaymentToken,brand});resolve();},onError:()=>reject(new Error('Não foi possível validar o cartão. Tente novamente.')),onInvalid:()=>reject(new Error('Verifique o nome, o número, a validade e o código do cartão.'))});});
 }catch(e){message(e.message,true);sending=false;$('#pay-button').disabled=false;}};
$('#demo-foreign').onclick=()=>{if(sending)return;sending=true;$('#demo-foreign').disabled=true;pay({demo:true,demoCurrency:$('#demo-currency').value});};
$('#brand').onchange=()=>{if(invoice)render(invoice);};
$('#currency-form').onsubmit=async event=>{
 event.preventDefault();if(sending)return;
 const currency=new FormData(event.currentTarget).get('currency');if(!currency)return;
 sending=true;$('#confirm-currency').disabled=true;
 try{render(await api(base+'/confirm-currency',{currency}));}catch(e){await load();message(e.message,true);}finally{sending=false;$('#confirm-currency').disabled=false;}
};
$('#print-receipt').onclick=()=>window.print();
$('#check-status').onclick=load;load();


function renderCurrency(i){
 $('#currency-form').hidden=i.state!=='currency_choice';
 $('#currency-receipt').hidden=!(i.state==='paid' && i.chosenCurrency && i.quote);
 if(i.state==='currency_choice'){
   const options=$('#currency-options');options.replaceChildren();
   const choices=[{currency:'BRL',label:money(i.amount)+' · Real brasileiro'},...i.quote.exchanges.map(o=>({currency:o.currency,label:foreignMoney(o.convertedAmount,o.currency,o.digits)+' · Moeda do cartão'}))];
   for(const choice of choices){const label=element('label',undefined,'currency-option');const input=element('input');input.type='radio';input.name='currency';input.value=choice.currency;input.required=true;label.append(input,element('span',choice.label));options.append(label);}
   const rates=i.quote.exchanges.map(o=>`1 BRL = ${new Intl.NumberFormat('pt-BR',{maximumFractionDigits:10}).format(o.conversionRate)} ${o.currency}`).join('; ');
   $('#exchange-details').textContent=i.quote.exchanges.length?`${i.mode==='demo'?'Câmbio fictício de demonstração':'Câmbio informado pela Cielo'}: ${rates}. A conversão inclui markup (taxa de câmbio) de ${i.quote.markupPercent}%, cobrado do doador. Ao escolher BRL, a conversão e eventuais encargos do cartão estrangeiro ficam a cargo do emissor.`:'A Cielo não ofereceu conversão para este cartão. O pagamento poderá ser confirmado em reais; eventuais conversões e encargos ficam a cargo do emissor.';
   $('#quote-deadline').textContent='Confirme até '+new Date(i.quote.expiresAt).toLocaleTimeString('pt-BR')+'. Depois desse horário será necessário conferir a cobrança.';
 }
 if(i.state==='paid' && i.chosenCurrency && i.quote){
   const selected=i.quote.exchanges.find(o=>o.currency===i.chosenCurrency);
   const lines=[i.mode==='demo'?'COMPROVANTE DE SIMULAÇÃO — sem valor financeiro':'Doação confirmada à Essência Viva',`Referência: ${i.id}`,`Valor da doação: ${money(i.amount)} (BRL)`,`Moeda escolhida pelo doador: ${i.chosenCurrency}`,`Valor do pagamento: ${selected?foreignMoney(selected.convertedAmount,selected.currency,selected.digits):money(i.amount)}`];
   if(selected)lines.push(`Câmbio: 1 BRL = ${selected.conversionRate} ${selected.currency}`,`Markup incluído: ${i.quote.markupPercent}%`);
   else lines.push('Conversão Cielo recusada. Eventuais conversões e encargos são definidos pelo emissor do cartão.');
   lines.push('Escolha confirmada em '+new Date(i.choiceAt).toLocaleString('pt-BR'));
   $('#receipt-details').textContent=lines.join('\n');
 }
}
