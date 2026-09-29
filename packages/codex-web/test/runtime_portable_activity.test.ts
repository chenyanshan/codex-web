import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CodexWebRuntime, type CodexWebRuntimeClient } from '../src/runtime.js';
import { CodexWebEventBus } from '../src/event_bus.js';
import { presentCodexWebEvent } from '../src/event_model.js';

function fixture() {
  const client = Object.assign(new EventEmitter(), {
    listModels: async () => [], readUsage: async () => null,
    listThreads: async () => ({threads:[],nextCursor:null}),
    readThread: async (threadId:string) => ({threadId,turns:[],runtimeStatus:{type:'idle'}}),
    startThread: async () => ({threadId:'thread'}), writeConfigValue: async () => {},
    startTurn: async () => ({threadId:'thread',turnId:'turn',status:'completed',outputText:''}),
    interruptTurn: async () => {}, respondToApproval: async () => {},
    request: async () => ({data:[],nextCursor:null}),
    diagnostics: () => ({server:{version:'0.156.1'}}),
    stop: async () => {},
  });
  const eventBus = new CodexWebEventBus();
  const runtime = new CodexWebRuntime({defaultCwd:'/tmp',client:client as unknown as CodexWebRuntimeClient,eventBus});
  return {client,eventBus,runtime};
}
test('portable events survive replay but remain hidden from summary/share audiences', async () => {
  const {client,eventBus,runtime} = fixture();
  const activity:any = {threadId:'thread',turnId:'turn',revision:1,health:{status:'retrying'}};
  client.emit('turn_activity',activity);
  client.emit('turn_activity',{...activity,revision:2});
  const request:any = {threadId:'thread',turnId:'turn',requestId:'question',status:'pending'};
  client.emit('user_input_request',request);
  client.emit('user_input_updated',{...request,status:'resolved'});
  const snapshot=eventBus.snapshot('turn').map(x=>x.event);
  const activities=snapshot.filter(x=>x.type==='turn.activity');
  assert.equal(activities.length,1);
  assert.equal(activities[0].activity.revision,2);
  assert.equal(snapshot.filter(x=>x.type==='user_input.updated').length,1);
  for(const event of snapshot) {
    assert.equal(presentCodexWebEvent(event,'share'),null);
    assert.equal(presentCodexWebEvent(event,'workspace_summary'),null);
    assert.ok(presentCodexWebEvent(event,'workspace'));
  }
  await runtime.stop();
  assert.equal(client.listenerCount('turn_activity'),0);
});
test('runtime reports observed version and requires authoritative global idle',async()=>{
  const {client,runtime}=fixture();
  assert.equal(runtime.runtimeVersionStatus().runningVersion,'0.156.1');
  assert.equal((await runtime.inspectRuntimeActivity()).idle,true);
  client.request=async()=>({data:['unknown'],nextCursor:null});
  client.readThread=async()=>null as any;
  assert.equal((await runtime.inspectRuntimeActivity()).idle,false);
  await runtime.stop();
});
