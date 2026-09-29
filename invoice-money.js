import {satoshis} from './bitcoin.js';
export const currencies=['BRL','USD','EUR','GBP','CAD','AUD','CHF','ARS','JPY','KWD','BTC',...Intl.supportedValuesOf('currency').filter(c=>!['BRL','USD','EUR','GBP','CAD','AUD','CHF','ARS','JPY','KWD'].includes(c))];
export function invoiceValue(value,currency){
 if(!currencies.includes(currency))throw new Error('Moeda da fatura inválida.');
 const digits=currency==='BTC'?8:new Intl.NumberFormat('pt-BR',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
 if(currency==='BTC')return {minor:satoshis(value),digits};
 const pattern=new RegExp('^[0-9]{1,9}'+(digits?'([.,][0-9]{1,'+digits+'})?':'')+'$');
 if(typeof value!=='string' || !pattern.test(value))throw new Error(`Informe o valor de ${currency} com até ${digits} casas decimais.`);
 const [whole,fraction='']=value.replace(',','.').split('.');const minor=Number(whole)*10**digits+Number(fraction.padEnd(digits,'0'));
 if(!Number.isSafeInteger(minor)||minor<=0)throw new Error('Valor de fatura inválido.');return {minor,digits};
}
