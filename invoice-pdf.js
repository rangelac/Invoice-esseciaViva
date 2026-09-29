import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
let active=0;
export function renderInvoicePdf(invoice){
 if(active>=3)return Promise.reject(new Error('Serviço ocupado.'));
 active++;
 return new Promise((resolve,reject)=>{
  const child=spawn(process.env.PYTHON_BIN || 'python',[fileURLToPath(new URL('./scripts/invoice_pdf.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const chunks=[];let bytes=0,done=false;
  const finish=(error,data)=>{if(done)return;done=true;clearTimeout(timer);active--;error?reject(error):resolve(data);};
  const timer=setTimeout(()=>{child.kill();finish(new Error('Tempo de geração excedido.'));},20000);
  child.on('error',error=>finish(error));child.stdin.on('error',error=>finish(error));
  child.stdout.on('data',data=>{bytes+=data.length;if(bytes>3000000){child.kill();finish(new Error('PDF muito grande.'));}else chunks.push(data);});
  child.stderr.resume();
  child.on('close',code=>{const output=Buffer.concat(chunks);finish(code===0 && output.subarray(0,5).toString()==='%PDF-'?null:new Error('Falha no PDF.'),output);});
  child.stdin.end(JSON.stringify(invoice));
 });
}
