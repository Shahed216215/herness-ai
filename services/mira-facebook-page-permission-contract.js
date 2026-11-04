'use strict';

// Structural Meta permission evidence assessment only.
// No token parsing, OAuth, Graph API request, authentication or authorization occurs.
const crypto = require('node:crypto');

const ROOT_KEYS = [
  'schemaVersion','appId','actorId','pageId','operation','grantedScopes',
  'pageTasks','appMode','accessLevel','appReviewStatus','featureApprovals',
  'checkedAt','evidenceRef','evidenceSource'
];
const OPERATIONS = new Set([
  'READ_PAGE_OWNED','READ_PUBLIC_PAGE_CONTENT','READ_USER_CONTENT','WRITE_PAGE_POST'
]);
const APP_MODES = new Set(['DEVELOPMENT','LIVE']);
const ACCESS_LEVELS = new Set(['STANDARD','ADVANCED']);
const REVIEW_STATES = new Set(['APPROVED','NOT_APPROVED','NOT_REQUIRED','UNKNOWN']);
const EVIDENCE_SOURCES = new Set([
  'META_APP_DASHBOARD','META_GRAPH_API_DEBUG_TOKEN','META_PAGE_SETTINGS','SYNTHETIC_FIXTURE'
]);
const ALLOWED_SCOPES = new Set([
  'pages_show_list','pages_read_engagement','pages_manage_posts',
  'pages_read_user_content','pages_manage_engagement'
]);
const ALLOWED_PAGE_TASKS = new Set([
  'ANALYZE','ADVERTISE','MODERATE','CREATE_CONTENT','MANAGE','MESSAGING'
]);
const ALLOWED_FEATURES = new Set([
  'PAGE_PUBLIC_CONTENT_ACCESS','BUSINESS_ASSET_USER_PROFILE_ACCESS'
]);
const REQUIREMENTS = Object.freeze({
  READ_PAGE_OWNED: Object.freeze({scopes:['pages_read_engagement'],tasks:[],features:[]}),
  READ_PUBLIC_PAGE_CONTENT: Object.freeze({scopes:[],tasks:[],features:['PAGE_PUBLIC_CONTENT_ACCESS']}),
  READ_USER_CONTENT: Object.freeze({scopes:['pages_read_user_content'],tasks:[],features:[]}),
  WRITE_PAGE_POST: Object.freeze({
    scopes:['pages_manage_posts','pages_read_engagement','pages_show_list'],
    tasks:['CREATE_CONTENT'],features:[]
  })
});
function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value,label,max=256) {
  if(typeof value!=='string'||!value.trim()||value.length>max) {
    throw new Error(label+' must be bounded non-empty text.');
  }
  return value.trim();
}
function exactKeys(value,keys) {
  return object(value)&&Object.keys(value).length===keys.length&&
    keys.every(key=>Object.prototype.hasOwnProperty.call(value,key));
}
function stringSet(value,label,allowed) {
  if(!Array.isArray(value)||value.length>64||
     value.some(item=>typeof item!=='string'||!allowed.has(item))||
     new Set(value).size!==value.length) {
    throw new Error(label+' must be a unique array of supported values.');
  }
  return value;
}
function assessDeclaredMetaPermissionEvidence({evidence,expectedContext,now=new Date(),maxAgeMs=15*60*1000}={}) {
  if(!exactKeys(evidence,ROOT_KEYS)) {
    throw new Error('Meta permission evidence must contain the exact supported fields.');
  }
  if(evidence.schemaVersion!=='1.0.0') throw new Error('Unsupported Meta permission evidence schema.');
  const appId=text(evidence.appId,'appId',64);
  const actorId=text(evidence.actorId,'actorId',128);
  const pageId=text(evidence.pageId,'pageId',32);
  const contextKeys=['appId','actorId','pageId','operation'];
  if(!exactKeys(expectedContext,contextKeys)) throw new Error('Expected Meta identity context must contain exact app/actor/Page/operation fields.');
  for(const key of contextKeys) text(expectedContext[key],'expectedContext.'+key,key==='pageId'?32:128);
  if(expectedContext.pageId!==undefined&&!/^\d{1,32}$/.test(expectedContext.pageId)) throw new Error('Expected Page ID must be numeric.');
  if(contextKeys.some(key=>evidence[key]!==expectedContext[key])) throw new Error('Permission evidence identity/operation binding mismatch.');
  if(!/^\d{1,32}$/.test(pageId)) throw new Error('pageId must be numeric.');
  if(!OPERATIONS.has(evidence.operation)) throw new Error('Unsupported Meta Page operation.');
  if(!APP_MODES.has(evidence.appMode)) throw new Error('Unsupported Meta app mode.');
  if(!ACCESS_LEVELS.has(evidence.accessLevel)) throw new Error('Unsupported Meta access level.');
  if(!REVIEW_STATES.has(evidence.appReviewStatus)) throw new Error('Unsupported App Review state.');
  if(!EVIDENCE_SOURCES.has(evidence.evidenceSource)) throw new Error('Unsupported permission evidence source.');
  const scopes=stringSet(evidence.grantedScopes,'grantedScopes',ALLOWED_SCOPES);
  const tasks=stringSet(evidence.pageTasks,'pageTasks',ALLOWED_PAGE_TASKS);
  const features=stringSet(evidence.featureApprovals,'featureApprovals',ALLOWED_FEATURES);
  const checkedAt=text(evidence.checkedAt,'checkedAt',64);
  const checked=Date.parse(checkedAt);
  const current=now instanceof Date?now.getTime():Date.parse(now);
  if(!Number.isFinite(checked)||!Number.isFinite(current)) throw new Error('Permission evidence timestamps are invalid.');
  if(!Number.isInteger(maxAgeMs)||maxAgeMs<0||maxAgeMs>24*60*60*1000) throw new Error('maxAgeMs is invalid.');
  const evidenceRef=text(evidence.evidenceRef,'evidenceRef',512);
  const missingScopes=REQUIREMENTS[evidence.operation].scopes.filter(scope=>!scopes.includes(scope));
  const missingPageTasks=REQUIREMENTS[evidence.operation].tasks.filter(task=>!tasks.includes(task));
  const missingFeatures=REQUIREMENTS[evidence.operation].features.filter(feature=>!features.includes(feature));
  const stale=checked>current||current-checked>maxAgeMs;
  const environmentBlockers=[];
  if(evidence.appMode!=='LIVE') environmentBlockers.push('APP_NOT_IN_LIVE_MODE');
  if(evidence.accessLevel!=='ADVANCED') environmentBlockers.push('ADVANCED_ACCESS_NOT_DECLARED');
  if(evidence.appReviewStatus!=='APPROVED') environmentBlockers.push('APP_REVIEW_NOT_APPROVED');
  if(stale) environmentBlockers.push('EVIDENCE_STALE_OR_FUTURE_DATED');
  const declaredRequirementsMet=missingScopes.length===0&&missingPageTasks.length===0&&missingFeatures.length===0&&!stale;
  const productionEligibleByDeclaredEvidence=declaredRequirementsMet&&environmentBlockers.length===0;
  const fingerprint=crypto.createHash('sha256').update([
    appId,actorId,pageId,evidence.operation,[...scopes].sort().join(','),
    [...tasks].sort().join(','),[...features].sort().join(','),checkedAt,evidenceRef
  ].join('|'),'utf8').digest('hex');
  return Object.freeze({
    schemaVersion:'1.0.0',
    appId,actorId,pageId,operation:evidence.operation,
    missingScopes:Object.freeze(missingScopes),
    missingPageTasks:Object.freeze(missingPageTasks),
    missingFeatures:Object.freeze(missingFeatures),
    declaredRequirementsMet,
    productionEligibleByDeclaredEvidence,
    environmentBlockers:Object.freeze(environmentBlockers),
    evidenceFresh:!stale,
    evidenceSource:evidence.evidenceSource,
    evidenceTrust:'CALLER_SUPPLIED_NOT_INDEPENDENTLY_VERIFIED',
    evidenceFingerprint:fingerprint,
    authorizationState:'NOT_AUTHORIZED_OFFLINE_EVIDENCE_ONLY',
    mayCallApi:false
  });
}
module.exports={assessDeclaredMetaPermissionEvidence,REQUIREMENTS,ROOT_KEYS};
