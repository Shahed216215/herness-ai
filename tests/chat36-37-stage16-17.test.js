'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const safety = require('../services/global-safety-governance');
const flow = require('../services/autonomous-orchestrator');

let passed=0;
function test(name,fn) {
  try { fn(); passed++; console.log('PASS',name); }
  catch(e) { console.error('FAIL',name,e.message); process.exitCode=1; }
}
const data=path.resolve(__dirname,'../data');
const audit=path.join(data,'stage16-17-audit.json');
const state=path.join(data,'stage16-17-state.json');
const oldAudit=fs.existsSync(audit)?fs.readFileSync(audit):null;
const oldState=fs.existsSync(state)?fs.readFileSync(state):null;
function reset() {
  fs.writeFileSync(audit,'[]');
  fs.writeFileSync(state,JSON.stringify({emergencyStop:false}));
}
try {
 reset();
 test('13-stage workflow contract',()=>{
   assert.strictEqual(flow.STAGES.length,13);
   assert.strictEqual(flow.STAGES[0],'find_work');
   assert.strictEqual(flow.STAGES[12],'improvement_proposal');
 });
 test('natural-language command classification',()=>{
   assert.strictEqual(flow.parseCommand('Excel-এর নতুন কাজ খুঁজে দেখো').intent,'find_work');
   assert.strictEqual(flow.parseCommand('Client message-এর উত্তর তৈরি করো').intent,'client_communication');
 });
 test('workflow creation rejects empty command',()=>{
   assert.throws(()=>flow.create({command:' '}),/COMMAND_REQUIRED/);
 });
 test('permission defaults to deny',()=>{
   assert.strictEqual(safety.check({action:'test'}).decision,'BLOCK');
 });
 test('explicit permission allows low-risk internal action',()=>{
   const r=safety.check({action:'internal-test',permitted:true,risk:'low'});
   assert.strictEqual(r.decision,'ALLOW');
 });
 test('external action requires approval',()=>{
   const r=safety.check({action:'send-message',permitted:true,external:true,risk:'low'});
   assert.strictEqual(r.decision,'APPROVAL_REQUIRED');
 });
 test('secret exposure is blocked',()=>{
   const r=safety.check({action:'secret-test',permitted:true,secretExposure:true});
   assert.strictEqual(r.decision,'BLOCK');
 });
 test('path escape is blocked',()=>{
   const r=safety.check({action:'file-test',permitted:true,pathEscape:true});
   assert.strictEqual(r.decision,'BLOCK');
 });
 test('duplicate action is blocked',()=>{
   assert.strictEqual(safety.check({action:'dup',permitted:true,duplicate:true}).decision,'BLOCK');
 });
 test('emergency stop blocks actions',()=>{
   safety.emergencyStop();
   assert.strictEqual(safety.check({action:'after-stop',permitted:true}).decision,'BLOCK');
   safety.resume();
 });
 test('audit chain verifies',()=>{
   assert.strictEqual(safety.verifyAudit().ok,true);
 });
 test('workflow execution requires explicit permission',()=>{
   const j=flow.create({command:'Analyze spreadsheet opportunity'});
   const r=flow.advance(j.id,{});
   assert.notStrictEqual(r.gate.decision,'ALLOW');
 });
 test('UI includes orchestrator and governance sections',()=>{
   const html=fs.readFileSync(path.resolve(__dirname,'../public/stage16-17.html'),'utf8');
   assert(html.includes('What do you want Mira to do?'));
   assert(/Security\s+(?:&amp;|&)\s*Governance/.test(html));
 });
 console.log('TESTS_PASSED='+passed);
 console.log('TESTS_STATUS='+(process.exitCode?'FAIL':'PASS'));
} finally {
  if(oldAudit===null) fs.rmSync(audit,{force:true}); else fs.writeFileSync(audit,oldAudit);
  if(oldState===null) fs.rmSync(state,{force:true}); else fs.writeFileSync(state,oldState);
}
