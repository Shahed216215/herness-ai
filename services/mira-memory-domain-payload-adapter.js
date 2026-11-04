'use strict';

// Read-only domain serializer. It prepares review candidates and never commits.
const crypto = require('node:crypto');
const { validateCanonicalMemoryRecord } = require('./mira-memory-conflict-assessment');
const { validateProjectMapping, digest } = require('./mira-memory-project-mapping-contract');

const SOURCES = Object.freeze({
  general_memory: 'mira_legacy_memory',
  knowledge: 'mira_legacy_knowledge',
  crm_conversation_message: 'mira_crm_conversation'
});
const TYPES = Object.freeze({
  general_memory: 'conversation_reference',
  knowledge: 'knowledge',
  crm_conversation_message: 'conversation_reference'
});
const sha = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function stable(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    const result = [];
    for (let i = 0; i < value.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) throw new Error('Sparse source arrays are not supported.');
      result.push(stable(value[i]));
    }
    return result;
  }
  if (!isObject(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error('Source contains a non-JSON value.');
  }
  const result = {};
  for (const key of Object.keys(value).sort()) {
    if (key === '__proto__') throw new Error('Forbidden source object key.');
    result[key] = stable(value[key]);
  }
  return result;
}
const stableStringify = value => JSON.stringify(stable(value));
function validDate(value) {
  if (typeof value !== 'string') return false;
  const m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:[.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$/.exec(value);
  if (!m) return false;
  const [, y, mo, d, h, mi, s, zone] = m;
  const year=+y, month=+mo, day=+d, hour=+h, minute=+mi, second=+s;
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(month<1||month>12||day<1||day>days[month-1]||hour>23||minute>59||second>60) return false;
  if(zone!=='Z'&&(+zone.slice(1,3)>23||+zone.slice(4,6)>59)) return false;
  return Number.isFinite(Date.parse(value));
}
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function requireText(value,label,max=100000) {
  if(typeof value!=='string'||!value.trim()||value.length>max) throw new Error(label+' is required.');
}
function sourceDigestFor(domain,entry,parentConversationId=null) {
  const envelope=domain==='crm_conversation_message'
    ? {conversationId:parentConversationId,message:entry}
    : {record:entry};
  return sha(stableStringify(envelope));
}
function createCanonicalCandidate({domain,sourceEntry,mapping,capturedAt}) {
  if(!isObject(sourceEntry)||!isObject(mapping)) throw new Error('Source entry and mapping are required objects.');
  if(SOURCES[domain]!==mapping.sourceSystem||mapping.domain!==domain) throw new Error('Domain/source-system mapping mismatch.');
  if(!validDate(capturedAt)) throw new Error('capturedAt must be RFC 3339.');
  let observedAt, sourceUrl=null;
  if(domain==='general_memory') {
    requireText(sourceEntry.role,'General Memory role',128);
    requireText(sourceEntry.content,'General Memory content');
    if(!validDate(sourceEntry.time)) throw new Error('General Memory time must be RFC 3339.');
    observedAt=sourceEntry.time;
    if(mapping.legacyId!=='legacy-memory:'+mapping.sourceFileDigest+':'+mapping.sourceOrdinal) throw new Error('General Memory snapshot locator mismatch.');
  } else if(domain==='knowledge') {
    requireText(sourceEntry.id,'Knowledge id',128);
    requireText(sourceEntry.title,'Knowledge title',300);
    requireText(sourceEntry.content,'Knowledge content',20000);
    if(sourceEntry.id!==mapping.legacyId) throw new Error('Knowledge legacy ID mismatch.');
    if(!validDate(sourceEntry.savedAt)) throw new Error('Knowledge savedAt must be RFC 3339.');
    observedAt=sourceEntry.savedAt;
    sourceUrl=typeof sourceEntry.url==='string'&&sourceEntry.url?sourceEntry.url:null;
  } else if(domain==='crm_conversation_message') {
    requireText(sourceEntry.messageId,'Persisted CRM messageId',200);
    requireText(sourceEntry.conversationId,'CRM conversationId',200);
    requireText(sourceEntry.content,'CRM content',10000);
    if(sourceEntry.messageId!==mapping.legacyId||sourceEntry.conversationId!==mapping.parentConversationId||sourceEntry.clientId!==mapping.clientId) throw new Error('CRM message/parent conversation/client mapping mismatch.');
    if(!validDate(sourceEntry.createdAt)||!validDate(sourceEntry.updatedAt)) throw new Error('CRM timestamps must be RFC 3339.');
    observedAt=sourceEntry.createdAt;
  } else throw new Error('Domain adapter is not implemented.');
  const envelope=stableStringify({domain,payload:sourceEntry});
  const record={
    schemaVersion:'1.0.0',memoryId:mapping.memoryId,projectId:mapping.projectId,
    recordType:TYPES[domain],content:envelope,
    source:{sourceType:'legacy_import',sourceId:mapping.legacyId,sourceUrl,observedAt},
    timestamps:{createdAt:capturedAt,updatedAt:capturedAt},
    version:{revision:1,contentHash:sha(JSON.stringify(envelope))},
    integrity:{status:'UNVERIFIED',algorithm:'SHA-256'},
    trust:{status:'SOURCE_RECORDED'},
    access:{classification:mapping.classification,allowedProjectIds:[mapping.projectId]},
    lifecycle:'PENDING_REVIEW'
  };
  const errors=validateCanonicalMemoryRecord(record,'candidate');
  if(errors.length) throw new Error('Canonical candidate invalid: '+errors.join('; '));
  return deepFreeze(record);
}
function adaptLegacyRecord({domain,sourceEntry,mapping,expectedProjectId,expectedSourceFileDigest,capturedAt,verifyApproval,now=new Date()}) {
  if(typeof expectedProjectId!=='string'||!expectedProjectId.trim()) throw new Error('Independent expectedProjectId is required.');
  if(typeof expectedSourceFileDigest!=='string'||! /^[a-f0-9]{64}$/.test(expectedSourceFileDigest)) throw new Error('Expected source snapshot SHA-256 is required.');
  if(!mapping||mapping.projectId!==expectedProjectId) throw new Error('Mapping project does not match independently requested project.');
  const nowMs=now instanceof Date?now.getTime():Date.parse(now);
  if(!Number.isFinite(nowMs)||!validDate(capturedAt)||Date.parse(capturedAt)>nowMs) throw new Error('Candidate capture time is invalid or future-dated.');
  const parent=domain==='crm_conversation_message'&&mapping?mapping.parentConversationId:null;
  const sourceDigest=sourceDigestFor(domain,sourceEntry,parent);
  if(!mapping||mapping.sourceDigest!==sourceDigest) throw new Error('Source digest mismatch.');
  const approved=validateProjectMapping({
    mapping,expectedDomain:domain,expectedProjectId,
    expectedSourceFileDigest,verifyApproval,now
  });
  const record=createCanonicalCandidate({domain,sourceEntry,mapping:approved,capturedAt});
  const canonicalRecordDigest=digest(record);
  if(approved.canonicalRecordDigest!==canonicalRecordDigest) throw new Error('Canonical candidate digest mismatch.');
  return Object.freeze({
    status:'READY_FOR_REVIEW_NOT_COMMITTED',committed:false,
    mappingId:approved.mappingId,sourceDigest,canonicalRecordDigest,record
  });
}

function adaptLegacyBatch({
  domain,sourceEntries,mappings,expectedProjectId,expectedSourceFileDigest,
  capturedAt,verifyApproval,now=new Date()
}) {
  if(!Array.isArray(sourceEntries)||!Array.isArray(mappings)) throw new Error('Source entries and mappings must be arrays.');
  if(typeof expectedProjectId!=='string'||!expectedProjectId.trim()) throw new Error('Independent expectedProjectId is required.');
  if(typeof expectedSourceFileDigest!=='string'||! /^[a-f0-9]{64}$/.test(expectedSourceFileDigest)) throw new Error('Expected source snapshot SHA-256 is required.');
  if(!SOURCES[domain]) throw new Error('Domain adapter is not implemented.');
  if(!validDate(capturedAt)) throw new Error('capturedAt must be RFC 3339.');
  const validated=validateProjectMappings({
    mappings,expectedDomain:domain,expectedProjectId,
    expectedSourceFileDigest,verifyApproval,now
  });
  const byLegacyId=new Map();
  for(const mapping of validated) {
    if(byLegacyId.has(mapping.legacyId)) throw new Error('Ambiguous mapping: source locator maps more than once.');
    byLegacyId.set(mapping.legacyId,mapping);
  }
  const seenSourceIds=new Set();
  const consumedMappingIds=new Set();
  const candidates=[];
  for(let ordinal=0;ordinal<sourceEntries.length;ordinal++) {
    if(!Object.prototype.hasOwnProperty.call(sourceEntries,ordinal)) throw new Error('Sparse source arrays are not supported.');
    const sourceEntry=sourceEntries[ordinal];
    if(!isObject(sourceEntry)) throw new Error('Source entry at ordinal '+ordinal+' must be an object.');
    let legacyId;
    if(domain==='general_memory') {
      legacyId='legacy-memory:'+expectedSourceFileDigest+':'+ordinal;
    } else if(domain==='knowledge') {
      requireText(sourceEntry.id,'Knowledge id',128);
      legacyId=sourceEntry.id;
    } else if(domain==='crm_conversation_message') {
      requireText(sourceEntry.messageId,'Persisted CRM messageId',200);
      legacyId=sourceEntry.messageId;
    } else {
      throw new Error('Domain adapter is not implemented.');
    }
    if(seenSourceIds.has(legacyId)) throw new Error('Ambiguous or duplicate source locator: '+legacyId);
    seenSourceIds.add(legacyId);
    const mapping=byLegacyId.get(legacyId);
    if(!mapping) throw new Error('Missing mapping for source locator: '+legacyId);
    if(domain!=='crm_conversation_message'&&mapping.sourceOrdinal!==ordinal) {
      throw new Error('Mapping sourceOrdinal does not match source snapshot position.');
    }
    if(consumedMappingIds.has(mapping.mappingId)) throw new Error('Ambiguous mapping reuse detected.');
    const adapted=adaptLegacyRecord({
      domain,sourceEntry,mapping,expectedProjectId,expectedSourceFileDigest,
      capturedAt,verifyApproval,now
    });
    consumedMappingIds.add(mapping.mappingId);
    candidates.push(adapted);
  }
  const unused=validated.filter(mapping=>!consumedMappingIds.has(mapping.mappingId));
  if(unused.length) throw new Error('Unused mapping entries are not permitted in a complete batch.');
  return Object.freeze(candidates);
}
module.exports={createCanonicalCandidate,adaptLegacyRecord,adaptLegacyBatch,sourceDigestFor,stableStringify};
