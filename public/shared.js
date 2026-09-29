export const labels={bitcoin_pending:'Aguardando Bitcoin',bitcoin_review:'Conferir Bitcoin',currency_choice:'Escolher moeda',quote_expired:'Cotação expirada',open:'Em aberto',paid:'Paga',review:'Em conferência',processing:'Processando',authorized:'Autorizada',declined:'Recusada',cancelled:'Cancelada',refunded:'Estornada',expired:'Vencida'};
export const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
export const date=s=>new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Rio_Branco'}).format(new Date(s));
export async function api(path,body) {
  let response;
  try { response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Essencia-Request':'1'},...(body===undefined?{}:{body:JSON.stringify(body)})}); } catch {throw new Error('Conexão interrompida. Consulte a situação antes de repetir o pagamento.');}
  const result=await response.json();
  if(!response.ok){const e=new Error(result.error || 'Não foi possível concluir.');e.status=response.status;throw e;}
  return result;
}
export function element(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}

export const foreignMoney=(amount,currency,digits)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency,currencyDisplay:'code'}).format(amount/10**digits);

export const invoiceMoney=i=>i.invoiceCurrency==='BTC'?'BTC '+(i.invoiceAmount/1e8).toFixed(8):new Intl.NumberFormat('pt-BR',{style:'currency',currency:i.invoiceCurrency||'BRL',currencyDisplay:i.invoiceCurrency==='BRL'?'symbol':'code'}).format((i.invoiceAmount??i.amount)/10**(i.invoiceDigits??2));
