import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'});
const results=[];const out=new URL('./',import.meta.url);
for(const language of ['en','zh-CN']){
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'});
 await page.addInitScript(language=>{localStorage.setItem('codexWebToken','approval-redesign-fixture');localStorage.setItem('codexWebLanguage',language);localStorage.setItem('codexWebTheme','fresh-light');},language);
 await page.goto('http://127.0.0.1:41761/');
 await page.locator('button[data-session-id="session_browser_fixture"]').click();
 await page.locator('[data-approval-action="accept"]').waitFor();
 await page.evaluate(async language=>{await fetch('/__test/turn-event',{method:'POST',headers:{Authorization:`Bearer ${localStorage.getItem('codexWebToken')}`,'Content-Type':'application/json'},body:JSON.stringify({type:'approval.requested',turnId:'turn_browser_active',approvalId:'approval_browser_fixture',approvalKind:'command',summary:{reason:language==='zh-CN'?'为检查手机与桌面页面，需要启动一个隔离的浏览器测试站点。':'Start the isolated browser test site to review phone and desktop pages.',command:'/bin/bash -lc "/home/ubuntu/workspace/.local/node-v24.16.0/bin/node packages/codex-web/test/browser/fixture-server.mjs --port=41761"',cwd:'/home/ubuntu/workspace/codex-mobile-web-app',availableDecisionKeys:['accept','acceptWithExecpolicyAmendment','cancel'],execPolicyAmendment:['/home/ubuntu/workspace/.local/node-v24.16.0/bin/node','packages/codex-web/test/browser/fixture-server.mjs']}})});},language);
 await page.locator('.approval-scope').waitFor();
 for(const width of [320,390,844,1440])for(const theme of ['fresh-light','terminal','dark-gold','oled-black','retro'])for(const layout of ['current','console']){
 await page.setViewportSize({width,height:width===844?390:900});
 await page.evaluate(({theme,layout})=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.sessionLayout=layout;},{theme,layout});
 const card=page.locator('.approval-card');await card.scrollIntoViewIfNeeded();
 const measured=await card.evaluate(card=>({overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...card.querySelectorAll('button')].map(b=>({label:b.textContent,width:b.clientWidth,scroll:b.scrollWidth,height:b.getBoundingClientRect().height}))}));
 assert.equal(measured.overflow,false);for(const b of measured.buttons){assert.ok(b.width>=b.scroll,`${width}/${theme}/${layout}/${b.label}`);assert.ok(b.height>=44);}
 results.push({width,theme,layout,language,...measured});
 if(theme==='fresh-light'&&layout==='current')await page.screenshot({path:new URL(`integrated-${width}-${language}.png`,out).pathname});
 }
 await page.close();
}
await writeFile(new URL('integrated-results.json',out),JSON.stringify(results,null,2));await browser.close();console.log(`${results.length} integrated cases passed.`);
