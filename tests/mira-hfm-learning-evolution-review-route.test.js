'use strict';

const assert = require('node:assert/strict');
const express = require('express');
const registerRoutes = require('../routes/mira-hfm-learning-evolution');

function responseRecorder() {
  return {
    statusCode:200,
    body:null,
    status(code) { this.statusCode=code; return this; },
    json(body) { this.body=body; return this; }
  };
}

async function main() {
  const registered=[];
  const app={ use(...args) { registered.push(args); } };
  const calls=[];
  const bridge={
    async review(projectId,proposalId,input,actor) {
      calls.push({projectId,proposalId,input,actor});
      if(input.decision==='CONFLICT') {
        const error=new Error('immutable review conflict');
        error.code='HFM_LEARNING_REVIEW_CONFLICT';
        throw error;
      }
      return { projectId,proposalId,decision:input.decision,
        status:'APPROVED_FOR_MANUAL_HANDOFF',trustState:'UNTRUSTED',
        canonicalMemoryWrites:0,automaticExecution:false };
    }
  };
  registerRoutes(app,()=>((req,res,next)=>next()),{SYSTEM_ADMIN:'system_admin'},
    {proposalStore:{},auditWriter:async()=>{},bridge});
  assert.equal(registered.length,1);
  const router=registered[0][2];
  const layer=router.stack.find(item=>item.route &&
    item.route.path==='/proposals/:projectId/:proposalId/review' &&
    item.route.methods.post);
  assert.ok(layer,'immutable review POST route must be registered');
  const handler=layer.route.stack[0].handle;

  const denied=responseRecorder();
  await handler({session:{authenticated:true,role:'admin'},params:{projectId:'project-a',proposalId:'proposal-a'},body:{decision:'APPROVE_FOR_MANUAL_HANDOFF',reason:'reviewed'}},denied);
  assert.equal(denied.statusCode,403);
  assert.equal(denied.body.code,'HFM_LEARNING_NAMED_ADMIN_SESSION_REQUIRED');
  assert.equal(calls.length,0);

  const approved=responseRecorder();
  await handler({session:{authenticated:true,role:'admin',username:'named-admin'},
    params:{projectId:'project-a',proposalId:'proposal-a'},
    body:{decision:'APPROVE_FOR_MANUAL_HANDOFF',reason:'Reviewed evidence; human handoff only.'}},approved);
  assert.equal(approved.statusCode,201);
  assert.equal(approved.body.review.trustState,'UNTRUSTED');
  assert.equal(approved.body.review.canonicalMemoryWrites,0);
  assert.equal(approved.body.review.automaticExecution,false);
  assert.deepEqual(calls[0].actor,{actorRole:'admin',actorId:'named-admin'});

  const conflict=responseRecorder();
  await handler({session:{authenticated:true,role:'admin',username:'named-admin'},
    params:{projectId:'project-a',proposalId:'proposal-a'},
    body:{decision:'CONFLICT',reason:'second decision'}},conflict);
  assert.equal(conflict.statusCode,409);
  assert.equal(conflict.body.code,'HFM_LEARNING_REVIEW_CONFLICT');

  console.log('HFM_PHASE8_REVIEW_ROUTE_NAMED_ADMIN_ENFORCEMENT=PASS');
  console.log('HFM_PHASE8_REVIEW_ROUTE_MANUAL_HANDOFF_ONLY=PASS');
  console.log('HFM_PHASE8_REVIEW_ROUTE_CONFLICT_HTTP_MAPPING=PASS');
  console.log('HFM_PHASE8_REVIEW_ROUTE_NO_CANONICAL_WRITES=PASS');
  console.log('TESTS_FAILED=0');
}

main().catch(error=>{ console.error(error); process.exitCode=1; });
