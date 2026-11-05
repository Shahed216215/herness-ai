'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');

// Minimal isolated Express Router contract: this test exercises route handlers,
// not Express internals, HTTP sockets, middleware packages or network access.
const originalLoad = Module._load;
function makeRouter() {
  const router = { stack: [] };
  for (const method of ['get', 'post']) {
    router[method] = (routePath, ...handlers) => {
      router.stack.push({
        route: {
          path: routePath,
          methods: { [method]: true },
          stack: handlers.map(handle => ({ handle }))
        }
      });
      return router;
    };
  }
  return router;
}
Module._load = function(request, parent, isMain) {
  if (request === 'express') return { Router: makeRouter };
  return originalLoad.call(this, request, parent, isMain);
};
const registerRoutes = require('../routes/mira-hfm-learning-evolution');
Module._load = originalLoad;

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
    async submit(proposalInput, context) {
      calls.push({proposalInput,context});
      return { status:'PENDING_HUMAN_REVIEW', trustState:'UNTRUSTED',
        canonicalMemoryWrites:0, automaticExecution:false };
    },
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
  const previousHookFlag = process.env.MIRA_HFM_LEARNING_GENERATION_HOOK_ENABLED;
  process.env.MIRA_HFM_LEARNING_GENERATION_HOOK_ENABLED = 'true';
  registerRoutes(app,()=>((req,res,next)=>next()),{SYSTEM_ADMIN:'system_admin'},
    {proposalStore:{},auditWriter:async()=>{},bridge});
  assert.equal(typeof app.locals.miraHfmLearningGenerationCycle.stage, 'function');
  const statusLayer = registered[0][2].stack.find(item => item.route &&
    item.route.path === '/status' && item.route.methods.get);
  assert.ok(statusLayer, 'HFM status GET route must be registered');
  const statusResponse = responseRecorder();
  await statusLayer.route.stack[0].handle({session:{authenticated:true,role:'admin',username:'named-admin'}}, statusResponse);
  assert.equal(statusResponse.body.success, true);
  assert.equal(statusResponse.body.generationCycleHookEnabled, true);
  assert.equal(statusResponse.body.canonicalMemoryWrites, 0);
  assert.equal(statusResponse.body.automaticExecution, false);
  const staged = await app.locals.miraHfmLearningGenerationCycle.stage({
    explicitOptIn:true, actor:{authenticated:true,role:'admin',actorId:'named-admin'},
    projectId:'project-alpha', proposalId:'proposal-route-001', title:'Candidate',
    rationale:'Review source', proposedChange:'Human review only',
    retrievalResult:{ providerId:'mira-hfm-public-web-retrieval',
      retrievalMode:'PUBLIC_FACEBOOK_SEARCH_INDEX_ONLY',
      status:'PUBLIC_WEB_EVIDENCE_COLLECTED_UNTRUSTED',
      page:{pageId:'123456789'}, lookup:{projectId:'project-alpha'},
      limits:{canonicalMemoryWrite:false,trustPromotion:false,directFacebookFetches:0,
        metaGraphApiCalls:0,loginOrCookieUse:0,privateOrGroupContentAccess:0},
      evidence:[{evidenceId:'route-evidence-001',pageId:'123456789',
        sourceUrl:'https://www.facebook.com/123456789/posts/987654321',
        sourceType:'FACEBOOK_PAGE_POST',identityBinding:'PAGE_ID_PRESENT_IN_INDEXED_RESULT',
        trustStatus:'SOURCE_RECORDED',integrityStatus:'UNVERIFIED',lifecycle:'PENDING_REVIEW',
        title:'Public post',snippet:'Untrusted evidence'}] }
  });
  assert.equal(staged.status, 'STAGED_FOR_HUMAN_REVIEW');
  assert.equal(calls[0].context.actorId, 'named-admin');
  if (previousHookFlag === undefined) delete process.env.MIRA_HFM_LEARNING_GENERATION_HOOK_ENABLED;
  else process.env.MIRA_HFM_LEARNING_GENERATION_HOOK_ENABLED = previousHookFlag;
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
  assert.equal(calls.length,1);

  const approved=responseRecorder();
  await handler({session:{authenticated:true,role:'admin',username:'named-admin'},
    params:{projectId:'project-a',proposalId:'proposal-a'},
    body:{decision:'APPROVE_FOR_MANUAL_HANDOFF',reason:'Reviewed evidence; human handoff only.'}},approved);
  assert.equal(approved.statusCode,201);
  assert.equal(approved.body.review.trustState,'UNTRUSTED');
  assert.equal(approved.body.review.canonicalMemoryWrites,0);
  assert.equal(approved.body.review.automaticExecution,false);
  assert.deepEqual(calls[1].actor,{actorRole:'admin',actorId:'named-admin'});

  const conflict=responseRecorder();
  await handler({session:{authenticated:true,role:'admin',username:'named-admin'},
    params:{projectId:'project-a',proposalId:'proposal-a'},
    body:{decision:'CONFLICT',reason:'second decision'}},conflict);
  assert.equal(conflict.statusCode,409);
  assert.equal(conflict.body.code,'HFM_LEARNING_REVIEW_CONFLICT');

  console.log('HFM_PHASE8_STATUS_ROUTE_NAMED_ADMIN_READ_ONLY=PASS');
  console.log('HFM_PHASE8_STATUS_ROUTE_NO_CANONICAL_WRITES=PASS');
  console.log('HFM_PHASE8_GENERATION_CYCLE_ROUTE_BRIDGE_EXPOSED=PASS');
  console.log('HFM_PHASE8_GENERATION_CYCLE_ROUTE_HUMAN_REVIEW_ONLY=PASS');
  console.log('HFM_PHASE8_REVIEW_ROUTE_NAMED_ADMIN_ENFORCEMENT=PASS');
  console.log('HFM_PHASE8_REVIEW_ROUTE_MANUAL_HANDOFF_ONLY=PASS');
  console.log('HFM_PHASE8_REVIEW_ROUTE_CONFLICT_HTTP_MAPPING=PASS');
  console.log('HFM_PHASE8_REVIEW_ROUTE_NO_CANONICAL_WRITES=PASS');
  console.log('TESTS_FAILED=0');
}

main().catch(error=>{ console.error(error); process.exitCode=1; });
