// DCC amounts are stored in minor units. Refuse quotes inconsistent with the rate.
export function currencyDigits(currency) {
  if(!Intl.supportedValuesOf('currency').includes(currency)) throw new Error('Moeda não reconhecida.');
  return new Intl.NumberFormat('pt-BR',{style:'currency',currency}).resolvedOptions().maximumFractionDigits;
}
export function readQuote(payment, amount, startedAt, markupPercent=16) {
  const options=payment.CurrencyExchangeData?.CurrencyExchanges || [];
  if(!Array.isArray(options) || options.length>1) throw new Error('Oferta ambígua: a confirmação Cielo não seleciona um código de moeda.');
  const exchanges=options.map(option=>{
    const currency=option.Currency;
    const digits=currencyDigits(currency);
    const convertedAmount=Number(option.ConvertedAmount), conversionRate=Number(option.ConversionRate);
    if(currency==='BRL' || !Number.isSafeInteger(convertedAmount) || convertedAmount<=0 || !Number.isFinite(conversionRate) || conversionRate<=0) throw new Error('Cotação inválida.');
    const expected=amount/100*conversionRate*10**digits;
    if(Math.abs(expected-convertedAmount)>1) throw new Error('Unidade da cotação inconsistente.');
    return {currency,convertedAmount,conversionRate,digits};
  });
  return {exchanges,expiresAt:new Date(Date.parse(startedAt)+20*60000).toISOString(),markupPercent};
}
export function demoQuote(currency, amount) {
  // Fictional rates solely for a labeled demonstration, never used in real payments.
  const rates={USD:0.20,EUR:0.18,GBP:0.16,JPY:30,KWD:0.061};
  if(!Object.hasOwn(rates,currency)) throw new Error('Moeda de demonstração inválida.');
  return {Currency:currency,ConversionRate:rates[currency],ConvertedAmount:Math.round(amount/100*rates[currency]*10**currencyDigits(currency))};
}
