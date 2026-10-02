import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
const money=(minor,currency='BRL',digits=2)=>currency+' '+new Intl.NumberFormat('pt-BR',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(minor/10**digits);
const date=v=>new Date(v).toLocaleDateString('pt-BR',{timeZone:'America/Rio_Branco'});
const states={open:'Em aberto',paid:'Paga',expired:'Vencida',bitcoin_pending:'Aguardando Bitcoin',bitcoin_review:'Bitcoin em conferência',currency_choice:'Aguardando escolha de pagamento',quote_expired:'Cotação expirada',processing:'Processando',review:'Em conferência',authorized:'Autorizada',declined:'Recusada',cancelled:'Cancelada',refunded:'Estornada'};
let active=0;
export async function renderInvoicePdf(data){
 if(active>=3)throw new Error('Serviço ocupado.');active++;
 try{
 const qr=await QRCode.toBuffer(data.url,{width:360,margin:4});
 return await new Promise((resolve,reject)=>{
 const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:'Fatura '+data.number,Author:'Instituto Essência Viva'}}),chunks=[];let bytes=0;
 doc.on('data',c=>{bytes+=c.length;if(bytes>3000000)doc.destroy(new Error('PDF muito grande.'));else chunks.push(c);});doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
 try{
 const width=doc.page.width-84,ink='#203c32',muted='#718072';let y=42;
 const style=(size=10,bold=false)=>doc.font(bold?'Helvetica-Bold':'Helvetica').fontSize(size);
 const height=(v,w=width,size=10)=>style(size).heightOfString(String(v),{width:w,lineGap:3});
 const text=(v,x,at,w=width,size=10,bold=false,color=ink)=>style(size,bold).fillColor(color).text(String(v),x,at,{width:w,lineGap:3});
 const room=h=>{if(y+h>doc.page.height-60){doc.addPage();y=42;}};
 const para=(v,size=10,bold=false,color=ink)=>{const h=height(v,width,size);room(h+6);text(v,42,y,width,size,bold,color);y=doc.y+6;};
 text('Fatura / Invoice',42,y,340,27,true);text('ESSÊNCIA VIVA\nDOAÇÕES',410,y,145,12,true);y+=50;
 for(const v of ['Número: '+data.number,'Emissão: '+date(data.createdAt),'Vencimento: '+date(data.expiresAt),'Situação: '+(states[data.state]||'Em conferência')])para(v);
 if(data.mode!=='production')para('DEMONSTRAÇÃO / TESTE - sem cobrança real',11,true);y+=12;
 const issuer='Instituto Essência Viva\nRua Valdomiro Lopes, 750 - Térreo 06\nRio Branco - Acre, 69918-764\nBrasil\n+55 68 98102-6481',recipient=['Faturado para',data.name||'Doador',data.email,data.billingAddress].filter(Boolean).join('\n');
 const ph=Math.max(height(issuer,255),height(recipient,240));
 if(ph>300){para(issuer);para(recipient);}else{room(ph+24);text(issuer,42,y,255);text(recipient,315,y,240);y+=ph+18;}
 const amount=money(data.invoiceAmount,data.invoiceCurrency,data.invoiceDigits);
 para(amount,24,true);para('Valor da fatura em '+data.invoiceCurrency+' - vencimento em '+date(data.expiresAt),9,false,muted);y+=8;
 const xs=[42,283,318,438],ws=[225,28,105,115],values=[data.description,'1',amount,amount],rh=Math.max(...values.map((v,i)=>height(v,ws[i])))+14;room(rh+40);
 ['Descrição','Qtd.','Valor unitário','Valor'].forEach((v,i)=>text(v,xs[i],y,ws[i],9,false,muted));y+=24;doc.strokeColor('#dce4d8').moveTo(42,y).lineTo(553,y).stroke();y+=10;
 values.forEach((v,i)=>text(v,xs[i],y,ws[i]));y+=rh+10;room(95);
 for(const [label,v,bold] of [['Subtotal',amount,false],['Total',amount,true],['Saldo a pagar',['paid','cancelled','refunded'].includes(data.state)?money(0,data.invoiceCurrency,data.invoiceDigits):amount,false]]){text(label,300,y,120,11,bold);text(v,430,y,123,11,bold);y+=24;}y+=10;
 if(data.donation){const d=data.donation;para('Ajuste autorizado pelo doador: '+money(d.minor,d.currency,d.digits)+'. Valor enviado ao cartão: '+money(data.amount)+'.',9,false,muted);para('Referência: '+d.source+' de '+d.date+'. O total original foi preservado. A doação ajustada quita esta solicitação quando o pagamento é confirmado.',9,false,muted);}
 else{if(data.allowAmountEdit)para('O doador pode ajustar o valor do cartão na página de pagamento. O total acima é o valor sugerido na emissão.',9,false,muted);if(data.invoiceCurrency!=='BRL')para('Pagamento com cartão: '+money(data.amount)+'. Equivalente em reais definido pela ONG na emissão; a cobrança Cielo é em BRL.',9,false,muted);}
 if(data.bitcoinAmount)para('Alternativa Bitcoin: '+money(data.bitcoinAmount,'BTC',8)+'. Rede Bitcoin. Consulte a página de pagamento.',9,false,muted);
 const local=/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(data.url),instructions='Escaneie o QR Code para abrir a página exclusiva desta fatura.\n'+data.url+(local?'\nLINK LOCAL: só funciona neste computador. Publique em HTTPS para compartilhar com doadores.':'');
 const bh=Math.max(142,height(instructions,340,9)+54);room(bh+58);doc.rect(42,y,width,bh).fill('#f2f5ed');doc.image(qr,50,y+12,{width:116,height:116});text('Pagar online / Pay online',180,y+16,350,13,true);doc.link(180,y+14,330,20,data.url);text(instructions,180,y+43,340,9,false,muted);y+=bh+15;
 para('Esta fatura é uma solicitação de doação, não uma nota fiscal. O QR Code abre a página de pagamento e não efetua uma transferência por si só.',8,false,muted);
 const range=doc.bufferedPageRange();for(let page=0;page<range.count;page++){doc.switchToPage(page);doc.strokeColor('#dce4d8').moveTo(42,doc.page.height-36).lineTo(553,doc.page.height-36).stroke();doc.page.margins.bottom=0;text('Instituto Essência Viva | '+data.number,42,doc.page.height-25,400,7,false,muted);text('Página '+(page+1),510,doc.page.height-25,50,7,false,muted);}doc.end();
 }catch(e){doc.destroy(e);}
 });
 }finally{active--;}
}
