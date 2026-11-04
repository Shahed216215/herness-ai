'use strict';

// Dependency-injected synchronous host adapter prototype.
// Real authentication, registry verification and atomic replay storage are supplied by the host.
const {validateProjectAuthorityEvidence}=require('./mira-memory-project-authority-contract');
function createHostAuthorizationAdapter({
 getProjectAuthorityEvidence,verifyProjectAuthorityEvidence,consumeReplayRequest,now=()=>new Date()
}){
 if(typeof getProjectAuthorityEvidence!=='function'||
    typeof verifyProjectAuthorityEvidence!=='function'||
    typeof consumeReplayRequest!=='function'){
  throw new Error('Trusted project evidence, verifier and atomic replay callbacks are required.');
 }
 return function authorizeRequest(input){
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Authorization input is required.');
  for(const key of ['actorId','actorType','projectId','purpose','requestId','authorityRef','contextIssuedAt','contextExpiresAt','operation','resourceScope']){
   if(typeof input[key]!=='string'||!input[key].trim()) throw new Error('Authorization input '+key+' is required.');
  }
  const evidence=getProjectAuthorityEvidence(Object.freeze({
   actorId:input.actorId,actorType:input.actorType,projectId:input.projectId,
   operation:input.operation,resourceScope:input.resourceScope,purpose:input.purpose,authorityRef:input.authorityRef
  }));
  if(!evidence||evidence.authorityRef!==input.authorityRef) throw new Error('Project authority reference mismatch.');
  const current=now();
  const nowMs=current instanceof Date?current.getTime():Date.parse(current);
  if(!Number.isFinite(nowMs)) throw new Error('Host authorization clock is invalid.');
  const verified=validateProjectAuthorityEvidence({
   evidence,expectedActorId:input.actorId,expectedActorType:input.actorType,
   expectedProjectId:input.projectId,expectedOperation:input.operation,
   expectedResourceScope:input.resourceScope,expectedPurpose:input.purpose,
   verifyEvidence:verifyProjectAuthorityEvidence,now:current
  });
  const fresh=consumeReplayRequest(Object.freeze({
   authorityRef:input.authorityRef,requestId:input.requestId,actorId:input.actorId,
   projectId:input.projectId,operation:input.operation,resourceScope:input.resourceScope,
   contextExpiresAt:input.contextExpiresAt
  }))===true;
  const expiresAt=Date.parse(verified.expiresAt)<Date.parse(input.contextExpiresAt)
   ? verified.expiresAt : input.contextExpiresAt;
  return Object.freeze({
   decision:fresh?'ALLOW':'DENY',actorId:input.actorId,actorType:input.actorType,
   projectId:input.projectId,purpose:input.purpose,requestId:input.requestId,
   operation:input.operation,resourceScope:input.resourceScope,authorityRef:input.authorityRef,
   issuedAt:new Date(nowMs).toISOString(),expiresAt,replayStatus:fresh?'FRESH':'REPLAYED'
  });
 };
}
module.exports={createHostAuthorizationAdapter};
