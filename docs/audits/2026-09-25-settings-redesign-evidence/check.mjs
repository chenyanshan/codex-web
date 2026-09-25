import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const out = new URL('./', import.meta.url);
const browser = await chromium.launch({ executablePath:'/home/ubuntu/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome' });
const results=[];
for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:568},{width:844,height:390}]) {
 const context=await browser.newContext({viewport, baseURL:'http://127.0.0.1:41762',serviceWorkers:'block'});
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('codexWebToken','settings-redesign');localStorage.setItem('codexWebLanguage','zh-CN');localStorage.setItem('codexWebTheme','fresh-light');});
 await page.route('**/app.js*',async route=>{const r=await route.fetch();await route.fulfill({response:r,body:`${await r.text()}\nglobalThis.__settingsTest={state,render,openAppSettingsPage,applyTheme};`});});
 await page.goto('/');await page.waitForFunction(()=>globalThis.__settingsTest?.state.authSession);
 await page.evaluate(()=>globalThis.__settingsTest.openAppSettingsPage());
 await expect(page.locator('#settings-content')).toBeVisible();
 if(viewport.width>980){const r=await page.locator('.desktop-settings-panel').boundingBox();expect(Math.abs(r.x+r.width/2-viewport.width/2)).toBeLessThan(2);await expect(page.locator('#desktop-settings-close-button')).toBeFocused();}
 await page.screenshot({path:new URL(`settings-${viewport.width}.png`,out).pathname});
 for(const theme of ['retro','dark-gold','oled-black','fresh-light','terminal']) {
  await page.evaluate(theme=>{__settingsTest.applyTheme(theme);__settingsTest.render();},theme);
  await page.screenshot({path:new URL(`settings-theme-${viewport.width}-${theme}.png`,out).pathname});
 }
 await page.evaluate(()=>{__settingsTest.applyTheme('fresh-light');__settingsTest.render();});
 await page.locator('[data-settings-group="account"]').click();await expect(page.locator('#settings-heading-account')).toBeFocused();
 await expect(page.locator('#webhook-enabled-toggle')).toBeEnabled();
 if(!await page.locator('#webhook-enabled-toggle').isChecked())await page.locator('#webhook-enabled-toggle').check();
 await expect(page.locator('#webhook-key-input')).toHaveAttribute('type','password');
 await page.locator('#webhook-reveal-key-button').click();await expect(page.locator('#webhook-key-input')).toHaveAttribute('type','text');
 await page.locator('#webhook-reveal-key-button').click();await expect(page.locator('#webhook-key-input')).toHaveAttribute('type','password');
 await page.locator('#webhook-rotate-key-button').click();await expect(page.locator('#webhook-rotate-cancel-button')).toBeFocused();
 await page.keyboard.press('Escape');await expect(page.locator('#webhook-rotate-key-button')).toBeFocused();
 await page.locator('#webhook-key-input').scrollIntoViewIfNeeded();await page.screenshot({path:new URL(`webhook-${viewport.width}.png`,out).pathname});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
 const navHeight=await page.locator('.settings-group-nav').evaluate(el=>el.getBoundingClientRect().height);
 if(viewport.width<=844) {
  await page.evaluate(()=>{__settingsTest.state.globalSettings.canSetSiteTitle=true;__settingsTest.render();});
  await page.locator('[data-settings-group="server"]').click();
  await page.locator('#site-title-input').fill('手机键盘可视区域检查');
  await page.setViewportSize({width:viewport.width,height:viewport.width===844?260:350});
  await page.locator('#site-title-input').scrollIntoViewIfNeeded();
  const inputBox=await page.locator('#site-title-input').boundingBox();
  expect(inputBox.y).toBeGreaterThanOrEqual(0);expect(inputBox.y+inputBox.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.screenshot({path:new URL(`settings-keyboard-${viewport.width}.png`,out).pathname});
 }
 expect(errors).toEqual([]);results.push({viewport,overflow,navHeight,errors});await context.close();
}
await fs.writeFile(new URL('results.json',out),JSON.stringify(results,null,2));await browser.close();
