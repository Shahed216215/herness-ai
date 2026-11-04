'use strict';

const fs=require('node:fs');
const path=require('node:path');
const EXTENSIONS=new Set(['.js','.cjs','.mjs','.ts']);
const SKIP=new Set(['.git','node_modules','vendor','dist','build','coverage','.next','tests','docs','reports','backups']);
const RULES=[
 ['PUBLIC_OR_INTERNAL_RETRIEVAL',/\b(?:getMemory|getKnowledge|getKnowledgeStats|getMemoryStats|searchKnowledge|searchMemory)\s*\(/],
 ['DIRECT_STORE_READ',/\b(?:loadMemory|loadKnowledge|readJsonArray|readJsonObject|readState)\s*\(/],
 ['GENERIC_STORE_LOADER',/\bloadStore\s*\(/],
 ['PROVIDER_OR_SNAPSHOT_READ',/\b(?:loadMemoryFromDrive|loadKnowledgeFromDrive|loadDriveState|readSnapshot|verifySnapshot|createSnapshot|restoreSnapshot)\s*\(/],
 ['CRM_CONVERSATION_READ',/\b(?:getConversation|listConversations|getMessage|listMessages|getContext)\s*\(/],
 ['WORK_LEARNING_OR_EXPERIENCE_READ',/\b(?:getLearningRecord|listLearningRecords|getLessons|listLessons|getExperience|listExperiences|getExperienceStats|retrieveExperiences|getExperiencesForTask|getRetrievalStats)\s*\(/],
 ['WORK_KNOWLEDGE_READ',/\b(?:getConsolidationItems|listConsolidationItems|searchConsolidatedKnowledge|getWorkKnowledge)\s*\(/]
];
function classifySource(relativePath,source){
 const matches=[];
 const lines=String(source).split(/\r?\n/);
 for(let i=0;i<lines.length;i++){
  if(/^\s*(?:\/\/|\*|\*\/)/.test(lines[i])) continue;
  for(const [category,pattern] of RULES){
   pattern.lastIndex=0;
   if(pattern.test(lines[i])) matches.push({line:i+1,category,excerpt:lines[i].trim().slice(0,220)});
  }
 }
 return {relativePath,matches};
}
function walk(root,relative=''){
 const absolute=path.join(root,relative),out=[];
 for(const entry of fs.readdirSync(absolute,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(entry.isSymbolicLink()) continue;
  const rel=relative?path.join(relative,entry.name):entry.name;
  if(entry.isDirectory()){if(!SKIP.has(entry.name))out.push(...walk(root,rel));continue;}
  if(entry.isFile()&&EXTENSIONS.has(path.extname(entry.name).toLowerCase()))out.push(rel);
 }
 return out;
}
function scan(root=process.cwd()){
 const findings=[];
 for(const relativePath of walk(root)){
  const source=fs.readFileSync(path.join(root,relativePath),'utf8');
  for(const match of classifySource(relativePath,source).matches) findings.push({file:relativePath,...match});
 }
 return findings;
}
if(require.main===module){
 const findings=scan(process.cwd());
 console.log('MIRA_HFM_ACCESS_PATH_CANDIDATE_INVENTORY=GENERATED');
 console.log('MIRA_HFM_ACCESS_PATH_CANDIDATE_COUNT='+findings.length);
 for(const [category] of RULES) console.log('MIRA_HFM_'+category+'_COUNT='+findings.filter(x=>x.category===category).length);
 for(const item of findings) console.log('MIRA_HFM_ACCESS_CANDIDATE='+item.file+':'+item.line+':'+item.category+':'+item.excerpt);
 console.log('STATIC_CANDIDATE_SCAN_ONLY=YES');
 console.log('SEMANTIC_REVIEW_REQUIRED=YES');
 console.log('RUNTIME_DATA_ACCESSED=NO');
 console.log('NETWORK_REQUESTS=0');
}
module.exports={classifySource,scan,RULES};
