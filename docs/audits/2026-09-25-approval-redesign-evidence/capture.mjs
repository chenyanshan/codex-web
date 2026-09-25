import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const out = new URL('./', import.meta.url);
const root = new URL('../../../', import.meta.url);
const [css, script, copy] = await Promise.all([readFile(new URL('packages/codex-web/public/approval-ui.css', root), 'utf8'), readFile(new URL('packages/codex-web/public/approval-ui.js', root), 'utf8'), readFile(new URL('./translations.json', out), 'utf8')]);
const browser = await chromium.launch({executablePath:'/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers:'block' });
await page.goto('http://127.0.0.1:41761/');
// Isolated component in the real stylesheet: no production calls or test command execution.
await page.setContent('<!doctype html><html><head><link rel="stylesheet" href="http://127.0.0.1:41761/styles.css"></head><body><main id="fixture" style="padding:16px;max-width:760px;margin:0 auto;width:100%;box-sizing:border-box"></main></body></html>');
await page.addStyleTag({content:css});
await page.addStyleTag({content:'body{display:block;overflow:auto;height:auto;min-height:100vh;background:var(--bg-base)}'});
await page.addScriptTag({content:await readFile(new URL('packages/codex-web/public/ui-copy.js', root), 'utf8')});
await page.addScriptTag({content:script});
const results=[];
for(const width of [320,390,844,1440]) for(const theme of ['fresh-light','terminal','dark-gold','oled-black','retro']) for(const language of ['en','zh-CN']) for(const layout of ['current','console']) {
 await page.setViewportSize({width,height:width===844?390:900});
 await page.evaluate(({theme,language,layout,copy})=>{
 document.documentElement.dataset.theme=theme;
 document.documentElement.dataset.sessionLayout=layout;
 const messages={...CodexWebCopy['zh-CN'],...JSON.parse(copy)};
 const t=x=>language==='zh-CN'?(messages[x]||x):x;
 const e=x=>String(x).replace(/[&<>"']/g,c=>`&#${c.charCodeAt(0)};`);
 const item={approvalId:'fixture',approvalKind:'command',summary:{reason:language==='zh-CN'?'为检查手机与桌面页面，需要启动一个隔离的浏览器测试站点。':'Start the isolated browser test site to review the phone and desktop pages.',command:'/bin/bash -lc "/home/ubuntu/workspace/.local/node-v24.16.0/bin/node packages/codex-web/test/browser/fixture-server.mjs --port=41761"',cwd:'/home/ubuntu/workspace/codex-mobile-web-app',availableDecisionKeys:['accept','acceptWithExecpolicyAmendment','cancel'],execPolicyAmendment:['/home/ubuntu/workspace/.local/node-v24.16.0/bin/node','packages/codex-web/test/browser/fixture-server.mjs']}};
 window.fixtureItem=item; window.fixtureHelpers={t,escapeHtml:e,escapeAttribute:e};
 document.querySelector('#fixture').innerHTML=CodexWebApprovalUi.render(item,window.fixtureHelpers);
 },{theme,language,layout,copy});
 const measured=await page.locator('.approval-card').evaluate(card=>({overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...card.querySelectorAll('button')].map(b=>({label:b.textContent,width:b.clientWidth,scroll:b.scrollWidth,height:b.getBoundingClientRect().height}))}));
 assert.equal(measured.overflow,false);
 for(const b of measured.buttons){assert.ok(b.scroll<=b.width,`${width}/${theme}/${language}: ${b.label} clipped`);assert.ok(b.height>=44);}
 results.push({width,theme,language,layout,...measured});
 if(layout==='current'&&((width===390&&language==='zh-CN')||(theme==='fresh-light'&&(width===320||width===1440||width===844)&&language==='en'))) await page.screenshot({path:new URL(`${width}-${theme}-${language}.png`,out).pathname,fullPage:true});
}
await page.setViewportSize({width:390,height:844});
for(const status of ['sending','uncertain','resolved','expired']){
 await page.evaluate(status=>{document.documentElement.dataset.theme='fresh-light';document.querySelector('#fixture').innerHTML=CodexWebApprovalUi.render({...fixtureItem,resolved:status==='resolved'||status==='expired',expired:status==='expired',decisionUncertain:status==='uncertain'}, {...fixtureHelpers,sending:status==='sending'});},status);
 await page.screenshot({path:new URL(`state-${status}.png`,out).pathname,fullPage:true});
}
await writeFile(new URL('results.json',out),JSON.stringify(results,null,2));
await browser.close();
console.log(`Passed ${results.length} viewport/theme/language/layout cases; no clipped buttons, >=44px controls.`);
