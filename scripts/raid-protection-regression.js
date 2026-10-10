'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../src/events/members/verificationLifecycle.js'), 'utf8');
const settings = new Map();
const enabled = new Map();
const sessions = new Map();
const history = [];
const analytics = [];
let clock = 100000;
const mocks = {
  '../../core/guild/guildManager': {isModuleEnabled: id => enabled.get(id) === true},
  '../../modules/securityStudio/verificationStore': {
    getVerificationSection: id => ({settings: settings.get(id)}),
    normalizeSettings: s => s,
    getSession: (g,u) => sessions.get(g+':'+u),
    upsertSession: (g,u,patch) => sessions.set(g+':'+u,{...(sessions.get(g+':'+u)||{}),...patch}),
    addSecurityHistory: (g,u,item) => history.push({g,u,...item}),
    incrementAnalytics: (g,item) => analytics.push({g,...item}),
  },
  '../../modules/securityStudio/verificationFlowContinuation': {},
  '../../modules/securityStudio/verificationChallengeInteractions': {},
  '../../modules/securityStudio/verificationQuarantine': {},
};
const context = {module:{exports:{}},exports:{},require: name => {
  assert(Object.hasOwn(mocks,name),'Unexpected import: '+name);
  return mocks[name];
},Date:class extends Date {static now(){return clock;}},Map,Math,Number,Boolean,String,console};
vm.runInNewContext(source,context,{filename:'verificationLifecycle.js'});
const {applyRaidPressure} = context.module.exports;
function member(g,u){return {guild:{id:g},id:u,user:{bot:false}};}
async function join(g,u){await applyRaidPressure(member(g,u));}
async function run(){
  enabled.set('A',true);enabled.set('B',true);
  settings.set('A',{raid:{enabled:true,automatic:true,elevateSecurity:true,joinThreshold:5,windowSeconds:30}});
  settings.set('B',{raid:{enabled:true,automatic:true,elevateSecurity:true,joinThreshold:2,windowSeconds:30}});
  for(let n=1;n<=4;n++)await join('A','a'+n);
  assert.equal(history.length,0,'Escalation before threshold');
  await join('B','b1');assert.equal(history.length,0,'Cross-guild leakage');
  await join('A','a5');
  assert.equal(history.length,1,'Fifth join must escalate');
  assert.equal(sessions.get('A:a5').raidJoinCount,5);
  await join('B','b2');
  assert.equal(history.length,2,'Second join in B must escalate independently');
  clock+=31000;
  await join('A','a6');
  assert.equal(history.length,2,'Expired join window must reset');
  settings.set('A',{raid:{enabled:false,automatic:true,elevateSecurity:true,joinThreshold:2,windowSeconds:30}});
  await join('A','disabled');
  settings.set('A',{raid:{enabled:true,automatic:true,elevateSecurity:true,joinThreshold:2,windowSeconds:30}});
  await join('A','fresh1');
  assert.equal(history.length,2,'Disabled raid must clear prior join count');
  await join('A','fresh2');
  assert.equal(history.length,3,'Reenabled raid must count fresh joins');
  enabled.set('A',false);
  await join('A','moduleOff');
  enabled.set('A',true);
  await join('A','moduleOn');
  assert.equal(history.length,3,'Master switch must clear raid join count');
  settings.set('A',{raid:{enabled:true,automatic:false,elevateSecurity:true,joinThreshold:2,windowSeconds:30}});
  await join('A','autoOff');
  settings.set('A',{raid:{enabled:true,automatic:true,elevateSecurity:false,joinThreshold:2,windowSeconds:30}});
  await join('A','elevationOff1');await join('A','elevationOff2');
  assert.equal(history.length,3,'Disabled escalation must not create enforcement history');
  assert.equal(analytics.length,3,'Analytics must track actual escalations');
  console.log('✅ Raid Protection runtime regression: threshold, expiry, guild isolation, disable/re-enable, automatic and escalation switches passed.');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
