import { randomUUID } from 'node:crypto';
export function cieloClient(env, fetcher = fetch) {
  const production = env.PAYMENT_MODE === 'production';
  const suffix = production ? '' : 'sandbox';
  const headers = () => ({MerchantId: env.CIELO_MERCHANT_ID, MerchantKey: env.CIELO_MERCHANT_KEY, 'Content-Type':'application/json', RequestId:randomUUID()});
  async function call(url, options) {
    const response = await fetcher(url, {...options, signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error('Cielo indisponível ou configuração recusada.');
    return response.json();
  }
  return {
    async sop() {
      const auth = await call(`https://auth${suffix}.braspag.com.br/oauth2/token`, {method:'POST', headers:{Authorization:'Basic '+Buffer.from(`${env.CIELO_SOP_CLIENT_ID}:${env.CIELO_SOP_CLIENT_SECRET}`).toString('base64'), 'Content-Type':'application/x-www-form-urlencoded'}, body:'grant_type=client_credentials'});
      if (!auth.access_token) throw new Error('Autenticação indisponível.');
      const token = await call(`https://transaction${suffix}.pagador.com.br/post/api/public/v2/accesstoken`, {method:'POST',headers:{MerchantId:env.CIELO_MERCHANT_ID, Authorization:`Bearer ${auth.access_token}`, 'Content-Type':'application/json'}});
      if (!token.AccessToken) throw new Error('Token indisponível.');
      return {accessToken:token.AccessToken, environment:production?'production':'sandbox'};
    },
    create(invoice, paymentToken, brand) {
      if(invoice.dcc_requested && !production) throw new Error("DCC requer o ambiente de produção da Cielo.");
      return call(`https://api${suffix}.cieloecommerce.cielo.com.br/v2/sales/`, {method:'POST',headers:headers(),body:JSON.stringify({MerchantOrderId:invoice.order_id, Customer:{Name:invoice.name}, Payment:{Type:'CreditCard',Amount:invoice.payment_amount ?? invoice.amount,...(invoice.dcc_requested?{DynamicCurrencyConversion:true}:{}),Installments:1,Capture:true,SoftDescriptor:'ESSENCIAVIVA',CreditCard:{PaymentToken:paymentToken,Brand:brand}}})});
    },
    confirm(id, convert) {
      if(!production) throw new Error('DCC requer o ambiente de produção da Cielo.');
      return call(`https://api.cieloecommerce.cielo.com.br/1/sales/${encodeURIComponent(id)}/confirm`,{method:'PUT',headers:headers(),body:JSON.stringify({CurrencyConversion:convert})});
    },
    query(id) { return call(`https://apiquery${suffix}.cieloecommerce.cielo.com.br/1/sales/${encodeURIComponent(id)}`,{headers:headers()}); },
    find(order) { return call(`https://apiquery${suffix}.cieloecommerce.cielo.com.br/1/sales?merchantOrderId=${encodeURIComponent(order)}`,{headers:headers()}); }
  };
}
