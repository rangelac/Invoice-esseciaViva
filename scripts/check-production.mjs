import PDFDocument from 'pdfkit';
const env=process.env;
const checks=[
 ['Modo de produção',env.PAYMENT_MODE==='production'],
 ['Pagamentos reais habilitados',env.ENABLE_LIVE_PAYMENTS==='true'],
 ['Domínio público HTTPS',(()=>{try{const u=new URL(env.PUBLIC_URL);return u.protocol==='https:' && !['localhost','127.0.0.1','[::1]'].includes(u.hostname);}catch{return false;}})()],
 ['Senha administrativa com ao menos 16 caracteres',Boolean(env.ADMIN_PASSWORD?.length>=16)],
 ...['CIELO_MERCHANT_ID','CIELO_MERCHANT_KEY','CIELO_SOP_CLIENT_ID','CIELO_SOP_CLIENT_SECRET'].map(k=>[k+' configurado',Boolean(env[k])]),
 ['Gerador de PDF disponível',typeof PDFDocument==='function']
];
for(const [label,ok] of checks)console.log(`${ok?'OK':'PENDENTE'}: ${label}`);
console.log('Esta verificação não realiza cobranças nem valida a habilitação comercial da conta.');
process.exitCode=checks.every(([,ok])=>ok)?0:1;
