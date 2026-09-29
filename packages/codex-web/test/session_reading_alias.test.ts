import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('canonical aliases preserve legacy reading anchors while later user scrolling still wins', async () => {
  const context: any = { setTimeout, clearTimeout };
  vm.runInNewContext(await readFile(new URL('../public/session-reading.js', import.meta.url), 'utf8'), context);
  const frames: Array<() => void> = [];
  let nodeId = 'legacy', nodeTop = 200;
  const timeline = { scrollTop: 250, scrollHeight: 1200, clientHeight: 400,
    getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
    querySelectorAll: () => [{ getAttribute: () => nodeId, getBoundingClientRect: () => ({ top: nodeTop - timeline.scrollTop, bottom: nodeTop + 600 - timeline.scrollTop }) }],
  };
  const controller = context.CodexWebSessionReading.createController({
    getSessionId: () => 'session', getOwner: () => 'owner', getTimeline: () => timeline,
    getFollowing: () => false, setFollowing() {}, isLatestWindow: () => true,
    resolveAnchorId: (id: string) => id === 'legacy' ? 'canonical' : id,
    storage: { getItem: () => null, setItem() {}, removeItem() {} },
    frame: (callback: () => void) => frames.push(callback),
  });
  const snapshot = controller.capture();
  nodeId = 'canonical'; nodeTop += 300; timeline.scrollHeight += 300;
  assert.equal(controller.restore(snapshot), true);
  assert.equal(timeline.scrollTop, 550);
  controller.input(); timeline.scrollTop = 700; controller.scrolled();
  frames.forEach(frame => frame());
  assert.equal(controller.restore(snapshot), false);
  assert.equal(timeline.scrollTop, 700);
  controller.flush();
});
