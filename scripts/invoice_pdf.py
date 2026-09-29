import sys, json, io, os
from datetime import datetime
from zoneinfo import ZoneInfo
from xml.sax.saxutils import escape
import reportlab
from reportlab.pdfgen import canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
fonts=os.path.join(os.path.dirname(reportlab.__file__),'fonts')
pdfmetrics.registerFont(TTFont('Vera',os.path.join(fonts,'Vera.ttf')))
pdfmetrics.registerFont(TTFont('VeraBold',os.path.join(fonts,'VeraBd.ttf')))
pdfmetrics.registerFontFamily('Vera',normal='Vera',bold='VeraBold',italic='Vera',boldItalic='VeraBold')
data=json.loads(sys.stdin.buffer.read().decode('utf-8'))
ink=HexColor('#203c32'); muted=HexColor('#718072'); green=HexColor('#315d46'); line=HexColor('#dce4d8')
styles={key:ParagraphStyle(key,fontName='VeraBold' if bold else 'Vera',fontSize=size,leading=size*1.5,textColor=color,spaceAfter=5) for key,size,bold,color in [('title',27,True,ink),('heading',11,True,ink),('body',9,False,ink),('small',8,False,muted),('amount',19,True,ink)]}
def p(text,style='body'):return Paragraph(escape(str(text)).replace('\n','<br/>'),styles[style])
def money(minor,currency='BRL',digits=2):
 whole,frac=divmod(int(minor),10**digits)
 return currency+' '+format(whole,',').replace(',','.')+(','+str(frac).zfill(digits) if digits else '')
def date(value):
 # Acre is UTC-05:00 without DST; avoid OS time-zone database dependency.
 from datetime import timezone,timedelta
 return datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(timezone(timedelta(hours=-5))).strftime('%d/%m/%Y')
amount=money(data['invoiceAmount'],data['invoiceCurrency'],data['invoiceDigits'])
status={'open':'Em aberto','paid':'Paga','expired':'Vencida','bitcoin_pending':'Aguardando Bitcoin','bitcoin_review':'Bitcoin em conferência','currency_choice':'Aguardando escolha de pagamento','quote_expired':'Cotação expirada','processing':'Processando','review':'Em conferência','authorized':'Autorizada','declined':'Recusada','cancelled':'Cancelada','refunded':'Estornada'}.get(data['state'],'Em conferência')
buf=io.BytesIO()
doc=SimpleDocTemplate(buf,pagesize=A4,rightMargin=42,leftMargin=42,topMargin=38,bottomMargin=48,title='Fatura '+data['number'],author='Instituto Essência Viva')
width=A4[0]-84
story=[]
header=Table([[p('Fatura / Invoice','title'),p('ESSÊNCIA VIVA\nDOAÇÕES','heading')]],colWidths=[width-140,140]);header.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0)]));story.append(header)
story.append(Spacer(1,12))
for text in ['Número: '+data['number'],'Emissão: '+date(data['createdAt']),'Vencimento: '+date(data['expiresAt']),'Situação: '+status]:story.append(p(text))
if data['mode']!='production':story.append(p('DEMONSTRAÇÃO / TESTE - sem cobrança real','heading'))
story.append(Spacer(1,17))
issuer='Instituto Essência Viva\nRua Valdomiro Lopes, 750 - Térreo 06\nRio Branco - Acre, 69918-764\nBrasil\n+55 68 98102-6481'
recipient='Faturado para\n'+data.get('name','Doador')
if data.get('email'):recipient+='\n'+data['email']
if data.get('billingAddress'):recipient+='\n'+data['billingAddress']
parties=Table([[p(issuer),p(recipient)]],colWidths=[width*.53,width*.47]);parties.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),14)]));story.append(parties);story.append(Spacer(1,23))
story.append(p(amount,'amount'))
story.append(p('Valor da fatura em '+data['invoiceCurrency']+' - vencimento em '+date(data['expiresAt']),'small'))
story.append(Spacer(1,15))
items=Table([[p('Descrição','small'),p('Qtd.','small'),p('Valor unitário','small'),p('Valor','small')],[p(data['description']),p('1'),p(amount),p(amount)]],colWidths=[width*.44,width*.07,width*.245,width*.245]);items.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LINEBELOW',(0,0),(-1,0),.7,line),('TOPPADDING',(0,0),(-1,-1),9),('BOTTOMPADDING',(0,0),(-1,-1),10),('LEFTPADDING',(0,0),(0,-1),0)]));story.append(items)
story.append(Spacer(1,12))
summary=Table([[p('Subtotal'),p(amount)],[p('Total','heading'),p(amount,'heading')],[p('Saldo a pagar'),p(money(0,data['invoiceCurrency'],data['invoiceDigits']) if data['state'] in ['paid','cancelled','refunded'] else amount)]],colWidths=[140,160],hAlign='RIGHT');summary.setStyle(TableStyle([('LINEABOVE',(0,1),(-1,1),.7,line),('TOPPADDING',(0,0),(-1,-1),7)]));story.append(summary)
story.append(Spacer(1,20))
pay=[]
if data.get('donation'):
 d=data['donation']
 pay.append(p('Ajuste autorizado pelo doador: '+money(d['minor'],d['currency'],d['digits'])+'. Valor enviado ao cartão: '+money(data['amount'])+'.','small'))
 pay.append(p('Referência: '+d['source']+' de '+d['date']+'. O total original da fatura foi preservado. A doação ajustada quita esta solicitação quando o pagamento é confirmado.','small'))
elif data.get('allowAmountEdit'):
 pay.append(p('O doador pode ajustar o valor do cartão na página de pagamento. O total acima é o valor sugerido na emissão.','small'))
if not data.get('donation') and data['invoiceCurrency']!='BRL':pay.append(p('Pagamento com cartão: '+money(data['amount'])+'. Equivalente em reais definido pela ONG na emissão; a cobrança Cielo é em BRL.','small'))
if data.get('bitcoinAmount'):pay.append(p('Alternativa Bitcoin: '+money(data['bitcoinAmount'],'BTC',8)+'. Rede Bitcoin. Consulte as instruções na página de pagamento.','small'))
url=data['url'];q=QrCodeWidget(url);bounds=q.getBounds();size=116;qr=Drawing(size,size,transform=[size/(bounds[2]-bounds[0]),0,0,size/(bounds[3]-bounds[1]),0,0]);qr.add(q)
link=Paragraph('<link href="'+escape(url,{'"':'&quot;'})+'" color="#315d46"><b>Pagar online / Pay online</b></link>',styles['heading'])
qrText=[link,p('Escaneie o QR Code para abrir a página exclusiva desta fatura.','small'),p(url,'small')]
if url.startswith('http://localhost') or url.startswith('http://127.0.0.1'):qrText.append(p('LINK LOCAL: só funciona no computador onde o sistema está aberto. Para compartilhar com doadores, publique o sistema em um domínio HTTPS.','small'))
qrTable=Table([[qr,qrText]],colWidths=[136,width-136]);qrTable.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'MIDDLE'),('BACKGROUND',(0,0),(-1,-1),HexColor('#f2f5ed')),('TOPPADDING',(0,0),(-1,-1),14),('BOTTOMPADDING',(0,0),(-1,-1),14)]));pay.extend([Spacer(1,12),qrTable,Spacer(1,12),p('Esta fatura é uma solicitação de doação, não uma nota fiscal. O QR Code abre a página de pagamento e não efetua uma transferência por si só.','small')]);story.append(KeepTogether(pay))
def footer(c,doc):
 c.setStrokeColor(line);c.line(42,36,A4[0]-42,36);c.setFillColor(muted);c.setFont('Vera',7);c.drawString(42,23,'Instituto Essência Viva | '+data['number']);c.drawRightString(A4[0]-42,23,'Página '+str(doc.page))
doc.build(story,onFirstPage=footer,onLaterPages=footer)
sys.stdout.buffer.write(buf.getvalue())
