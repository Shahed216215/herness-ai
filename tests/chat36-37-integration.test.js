'use strict';
const assert=require('assert');
const fs=require('fs');
const path=require('path');
const os=require('os');
const cp=require('child_process');

let passed=0;
function test(name,fn){
 try{fn();passed++;console.log('PASS',name);}
 catch(e){console.error('FAIL',name,e.stack||e);process.exitCode=1;}
}
const root=path.resolve(__dirname,'..');
test('server registers Stage 16-17 routes with existing auth middleware',()=>{
 const s=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert(s.includes('require("./routes/stage16-17")'));
 assert(s.includes('registerStage16_17Routes('));
 assert(s.includes('requireAgentAuth'));
 assert(s.includes('requireAdminPermission'));
});
test('route contract protects agent and admin endpoints',()=>{
 const register=require('../routes/stage16-17');
 const routes={};
 const app={get:(p,...h)=>routes['GET '+p]=h,post:(p,...h)=>routes['POST '+p]=h};
 const auth=(req,res,next)=>next();
 const agentPermission=()=>auth;
 const adminPermission=()=>auth;
 register(app,auth,agentPermission,adminPermission,{CLIENT_PROJECTS:'CLIENT_PROJECTS'});
 assert(routes['GET /api/stage16-17/status'].length>=3);
 assert(routes['POST /api/stage16-17/workflows'].length>=3);
 assert(routes['POST /api/stage16-17/workflows/:id/approve'].length>=2);
 assert(routes['POST /api/stage16-17/emergency-stop'].length>=2);
});
test('workflow persists and is restored after module restart',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mira-stage16-17-'));
 const store=path.join(dir,'workflows.json');
 const env={...process.env,MIRA_STAGE16_17_WORKFLOWS_FILE:store};
 const run=code=>cp.execFileSync(process.execPath,['-e',code],{cwd:root,env,encoding:'utf8'});
 try{
  const id=run("const f=require('./services/autonomous-orchestrator'); console.log(f.create({command:'restart persistence test'}).id)").trim();
  const result=JSON.parse(run("const f=require('./services/autonomous-orchestrator'); console.log(JSON.stringify(f.get("+JSON.stringify(id)+")))"));
  assert.strictEqual(result.id,id);
  assert.strictEqual(result.command,'restart persistence test');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('corrupt workflow store fails closed at startup',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mira-stage16-17-corrupt-'));
 const store=path.join(dir,'workflows.json');
 fs.writeFileSync(store,'{broken');
 const env={...process.env,MIRA_STAGE16_17_WORKFLOWS_FILE:store};
 try{
  const r=cp.spawnSync(process.execPath,['-e',"require('./services/autonomous-orchestrator')"],{cwd:root,env,encoding:'utf8'});
  assert.notStrictEqual(r.status,0);
  assert((r.stderr||'').includes('ORCHESTRATOR_STORE_INVALID'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
console.log('INTEGRATION_TESTS_PASSED='+passed);
console.log('INTEGRATION_TESTS_STATUS='+(process.exitCode?'FAIL':'PASS'));
