import { CodexWebEventBus } from '../../src/event_bus.js';

if (typeof global.gc !== 'function') {
  throw new Error('event_bus_memory_scenario requires --expose-gc');
}

const turns = Number(process.env.CODEX_MEMORY_TURNS ?? 100);
const deltasPerTurn = Number(process.env.CODEX_MEMORY_DELTAS ?? 500);
const payloadCharacters = Number(process.env.CODEX_MEMORY_DELTA_CHARS ?? 80);
const bus = new CodexWebEventBus({ maxEventsPerTurn: 500, maxTurns: 200, epoch: 'memory_scenario' });
let peakHeapUsed = process.memoryUsage().heapUsed;
const outputs = Array.from({ length: turns }, () => '');

for (let index = 0; index < deltasPerTurn; index += 1) {
  for (let turn = 0; turn < turns; turn += 1) {
    const prefix = `${String(index).padStart(4, '0')}:`;
    const delta = `${prefix}${'x'.repeat(Math.max(0, payloadCharacters - prefix.length - 1))}\n`;
    outputs[turn] += delta;
    bus.append(`turn_${turn}`, {
      id: `event_${turn}_${index}`,
      type: 'batch.updated',
      turnId: `turn_${turn}`,
      batchId: `command_${turn}`,
      summary: { output: outputs[turn], outputDelta: delta },
      raw: {
        method: 'item/commandExecution/outputDelta',
        params: { delta },
      },
    });
  }
  peakHeapUsed = Math.max(peakHeapUsed, process.memoryUsage().heapUsed);
}

let serializedBytes = 0;
for (let turn = 0; turn < turns; turn += 1) {
  for (const entry of bus.list(`turn_${turn}`)) {
    serializedBytes += Buffer.byteLength(JSON.stringify(entry));
  }
  for (const entry of bus.snapshot(`turn_${turn}`)) {
    serializedBytes += Buffer.byteLength(JSON.stringify(entry));
  }
  peakHeapUsed = Math.max(peakHeapUsed, process.memoryUsage().heapUsed);
}

global.gc();
global.gc();
const memory = process.memoryUsage();
process.stdout.write(`${JSON.stringify({
  turns,
  deltasPerTurn,
  payloadCharacters,
  serializedBytes,
  peakHeapUsed,
  heapUsedAfterGc: memory.heapUsed,
  rssAfterGc: memory.rss,
  retention: bus.retentionStats(),
  sentinel: bus.list('turn_0').length,
})}\n`);
