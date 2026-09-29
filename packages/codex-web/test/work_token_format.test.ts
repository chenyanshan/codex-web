import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('token counts use readable decimal units without losing threshold or unknown semantics', async () => {
  const context: any = {};
  vm.runInNewContext(await fs.readFile(new URL('../public/work-details-view.js', import.meta.url), 'utf8'), context);
  const format = context.CodexWebWorkView.formatTokenCount;
  for (const [value, expected] of [[0,'0'], [999,'999'], [1000,'1K'], [12500,'12.5K'], [999999,'1M'], [1250000,'1.25M'], [2400000000,'2.4B'], [1e12,'1000B'], [null,'—'], [NaN,'—'], [-1,'—']]) assert.equal(format(value), expected);
});
