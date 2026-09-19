import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

async function harness() {
  const context: any = { setTimeout, clearTimeout };
  vm.runInNewContext(await readFile(new URL('../public/session-reading.js', import.meta.url), 'utf8'), context);
  const frames: Function[] = [];
  const storage = new Map<string, string>();
  const state = { id: 'a', owner: 'user:a', following: false, latest: true };
  let messageTop = 200;
  const timeline = { scrollTop: 250, scrollHeight: 1200, clientHeight: 400,
    getBoundingClientRect: () => ({ top: 0, bottom: 400 }),
    querySelectorAll: () => [{ getAttribute: () => 'message-a', getBoundingClientRect: () => ({ top: messageTop - timeline.scrollTop, bottom: messageTop + 600 - timeline.scrollTop }) }],
  };
  const controller = context.CodexWebSessionReading.createController({
    getSessionId: () => state.id, getOwner: () => state.owner, getTimeline: () => timeline,
    getFollowing: () => state.following, setFollowing: (next: boolean) => { state.following = next; },
    isLatestWindow: () => state.latest,
    storage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    frame: (callback: Function) => frames.push(callback),
  });
  return { controller, state, timeline, frames, storage, prepend: (height: number) => { messageTop += height; timeline.scrollHeight += height; } };
}

test('prepend and content changes preserve the visible message anchor', async () => {
  const { controller, timeline, prepend, frames } = await harness();
  const snapshot = controller.capture();
  prepend(300);
  controller.restore(snapshot);
  assert.equal(timeline.scrollTop, 550);
  for (const frame of frames) frame();
  assert.equal(timeline.scrollTop, 550);
  controller.flush();
});

test('user scroll invalidates delayed restoration even within the same session', async () => {
  const { controller, timeline, frames } = await harness();
  const snapshot = controller.capture();
  controller.restore(snapshot);
  controller.input(); timeline.scrollTop = 600; controller.scrolled();
  for (const frame of frames) frame();
  assert.equal(controller.restore(snapshot), false);
  assert.equal(timeline.scrollTop, 600);
  controller.flush();
});

test('delayed frame from another session or user cannot reposition the active timeline', async () => {
  const { controller, timeline, state, frames } = await harness();
  const snapshot = controller.capture(); controller.restore(snapshot);
  state.id = 'b'; timeline.scrollTop = 720;
  for (const frame of frames) frame();
  assert.equal(timeline.scrollTop, 720);
  state.id = 'a'; state.owner = 'user:b';
  assert.equal(controller.restore(snapshot), false);
  controller.flush();
});

test('reading positions are bounded and scoped to the account, and logout clears them', async () => {
  const { controller, state, storage } = await harness();
  for (let index = 0; index < 25; index++) { state.id = `session-${index}`; controller.remember(); controller.flush(); }
  assert.equal(Object.keys(JSON.parse(storage.get('codexWebReading:user:a')!)).length, 20);
  assert.equal(controller.saved().sessionId, 'session-24');
  state.owner = 'user:b';
  assert.equal(controller.saved(), null);
  state.owner = 'user:a'; controller.clear();
  assert.equal(controller.saved(), null);
});

test('the end of an older DOM window never enables following the real latest messages', async () => {
  const { controller, timeline, state } = await harness();
  state.latest = false; timeline.scrollTop = 800;
  controller.scrolled();
  assert.equal(state.following, false);
  assert.equal(controller.capture().shouldFollowLatest, false);
});
