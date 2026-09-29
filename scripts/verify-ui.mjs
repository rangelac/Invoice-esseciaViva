import {chromium} from '@playwright/test';
import {createApp} from '../server.js';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
const {app,db}=createApp({ADMIN_PASSWORD:'ui-test-password-only-123',PAYMENT_MODE:'demo',PUBLIC_URL:'http://localhost:3107',DB_PATH:':memory:'});
const server=app.listen(3107,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const browser=await chromium.launch({headless:true,...(process.env.UI_BROWSER_CHANNEL?{channel:process.env.UI_BROWSER_CHANNEL}:{})});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3107');await page.locator('[name=password]').fill('ui-test-password-only-123');await page.getByRole('button',{name:/Entrar no painel/}).click();await page.locator('#dashboard').waitFor({state:'visible'});
 await page.getByRole('button',{name:'＋ Nova cobrança'}).click();await page.locator('[name=name]').fill('Doador de demonstração');await page.locator('[name=amount]').fill('150,00');await page.locator('[name=description]').fill('Apoio às atividades da Essência Viva');await page.locator('#create-submit').click();await page.locator('#share-dialog').waitFor({state:'visible'});const url=await page.locator('#share-link').inputValue();assert.match(url,/localhost:3107\/p\//);await page.locator('#close-share').click();
 mkdirSync('.preview',{recursive:true});await page.screenshot({path:'.preview/dashboard.png',fullPage:true});
 const donor=await browser.newPage({viewport:{width:1280,height:900}});await donor.goto(url);await donor.getByRole('button',{name:'Simular doação'}).waitFor({state:'visible'});assert.equal(await donor.locator('#amount').textContent(),'R$ 150,00');await donor.screenshot({path:'.preview/checkout.png',fullPage:true});
 await donor.setViewportSize({width:390,height:844});await donor.screenshot({path:'.preview/mobile.png',fullPage:true});assert.equal(await donor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await donor.getByRole('button',{name:'Simular doação'}).click();await donor.getByText('Doação simulada com sucesso! Nenhuma cobrança foi realizada.').waitFor();await donor.reload();await donor.getByText('Doação simulada com sucesso! Nenhuma cobrança foi realizada.').waitFor();assert.equal(await donor.locator('#pay-form').isVisible(),false);
 await page.locator('#reload').click();await page.getByText('Paga',{exact:true}).waitFor();assert.equal(await page.locator('#total-paid').textContent(),'R$ 150,00');await page.locator('#search').fill('inexistente');await page.getByText('Nenhuma cobrança encontrada.').waitFor();await page.locator('#search').fill('');await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.preview/dashboard-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('Fluxo de navegador aprovado: login, criação, link, pagamento demo, persistência, resumo, filtro e telas móveis.');
} finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close();}
