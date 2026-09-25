import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'});
for(const width of [320,390,844]) {
 const context=await browser.newContext({viewport:{width,height:width===844?390:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});const page=await context.newPage();
 await page.addInitScript(()=>{localStorage.setItem('codexWebToken','header-audit');localStorage.setItem('codexWebLanguage','zh-CN');});
 await page.route('**/app.js*',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:`${await r.text()}\nglobalThis.__headerAudit={state,render,applyTheme,applyLanguage,setSessionLayout};`});});
 await page.route('**/api/sessions/session_browser_history**',async route=>{const response=await route.fetch();const data=await response.json();if(data.session)Object.assign(data.session,{title:'排查家庭智能中控长任务的网络重试与会话恢复问题，并核对目标 Token 用量',cwd:'/workspace/这是一个非常长的智能家居生产项目名称',goal:{status:'active',objective:'检查目标用量与任务执行结果，修复当前手机会话顶部无法显示的信息'},activeTurnId:'turn_browser_active',activityState:'running',turnStartedAt:Date.now()-253000,lastBusinessActivityAt:Date.now()-32000});await route.fulfill({response,json:data});});
 await page.goto('http://127.0.0.1:41762');await page.locator('[data-session-id="session_browser_history"]').click();
 await page.evaluate(()=>{const {state,render}=__headerAudit;state.currentSession={...state.currentSession,title:'排查家庭智能中控长任务的网络重试与会话恢复问题，并核对目标 Token 用量',cwd:'/workspace/这是一个非常长的智能家居生产项目名称',goal:{status:'active',objective:'检查目标用量与任务执行结果，修复当前手机会话顶部无法显示的信息'},turnStartedAt:Date.now()-253000,lastBusinessActivityAt:Date.now()-32000};state.pendingTurn=true;state.turnId='header-test';state.streamConnection='reconnecting';render();});
 await page.screenshot({path:`docs/audits/2026-09-25-session-polish-evidence/header-${process.env.HEADER_STAGE||'before'}-${width}.png`});
 if(process.env.HEADER_STAGE==='after') {await page.locator('#settings-toggle').click();await page.screenshot({path:`docs/audits/2026-09-25-session-polish-evidence/header-after-menu-${width}.png`});}
 await context.close();
}
await browser.close();
