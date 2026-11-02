'use strict';
const fs=require('node:fs');
const path=require('node:path');

async function main(){
 const auditFile=process.env.TEST_AUDIT_FILE;
 if(!auditFile) throw Error('TEST_AUDIT_FILE_REQUIRED');
 process.env.MIRA_AUDIT_FILE=auditFile;
 process.env.MIRA_AUDIT_HMAC_KEY='chat2-isolated-test-key-not-for-production';
 delete process.env.MIRA_SESSION_SECRET;

 const audit=require('../audit-log');
 const cap=require('../capability-profile');
 let writerCalls=0;
 cap.recordSkillFailure=(skill)=>{
   writerCalls++;
   return {
     ok:true,saved:true,skillId:String(skill),
     skillKey:String(skill),failure:{failureId:'test-only'}
   };
 };

 const qa=require('../services/mira-quality-assurance-engine');
 const options={
   task:{id:'chat2-order-regression',title:'Isolated regression',requiredSkills:['excel']},
   plan:{steps:[]},
   executionResult:{executionId:'isolated-execution',success:false,results:[]}
 };

 // Establish that this input exercises the skill-failure path.
 const normal=await qa.runQualityAssurance(options);
 if(normal.status!=='qa_failed')
   throw Error('TEST_INPUT_DID_NOT_TRIGGER_QA_FAILURE');
 if(writerCalls<1)
   throw Error('CONTROL_DID_NOT_REACH_SKILL_WRITER');
 console.log('PASS=CONTROL_CONFIRMS_SKILL_WRITER_PATH');

 const before=JSON.parse(fs.readFileSync(auditFile,'utf8'));
 if(!before.length || !before.some(e=>e.integrityVersion===2))
   throw Error('V2_AUDIT_STREAM_NOT_ESTABLISHED');

 writerCalls=0;
 delete process.env.MIRA_AUDIT_HMAC_KEY;
 delete process.env.MIRA_SESSION_SECRET;

 let rejected=false;
 try {
   await qa.runQualityAssurance(options);
 } catch(e) {
   rejected=/HMAC key unavailable/i.test(String(e && e.message));
   if(!rejected) throw e;
 }
 if(!rejected) throw Error('QA_DID_NOT_FAIL_CLOSED');
 console.log('PASS=QA_PROMISE_REJECTS_ON_MISSING_HMAC');

 if(writerCalls!==0)
   throw Error('SKILL_WRITER_CALLED_BEFORE_AUDIT_GUARD');
 console.log('PASS=NO_SKILL_SIDE_EFFECT_BEFORE_AUDIT');

 const after=JSON.parse(fs.readFileSync(auditFile,'utf8'));
 if(after.length!==before.length)
   throw Error('AUDIT_ENTRY_COUNT_CHANGED_ON_BLOCKED_CALL');
 console.log('PASS=NO_EXTRA_AUDIT_ENTRY');

 process.env.MIRA_AUDIT_HMAC_KEY='chat2-isolated-test-key-not-for-production';
 const verify=audit.verifyAuditIntegrity();
 if(!verify || verify.ok!==true)
   throw Error('TEMP_AUDIT_INTEGRITY_NOT_VALID');
 console.log('PASS=TEMP_AUDIT_INTEGRITY');
 console.log('TEST_STATUS=PASS');
}
main().catch(e=>{
 console.error('TEST_STATUS=FAIL');
 console.error('FAILURE='+String(e && e.message || e).slice(0,240));
 process.exitCode=1;
});
