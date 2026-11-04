'use strict';
const fs=require('node:fs');
const path=require('node:path');
const EXTENSIONS=new Set(['.js','.cjs','.mjs','.ts']);
const SKIP=new Set(['.git','node_modules','vendor','dist','build','coverage','.next','tests','docs','reports','backups']);
const RULES=[
 ['PUBLIC_OR_INTERNAL_RETRIEVAL',/\b(?:getMemory|getKnowledge|getKnowledgeStats|getMemoryStats|searchKnowledge|searchMemory)\s*\(/],
 ['DIRECT_STORE_READ',/\b(?:loadMemory|loadKnowledge|readJsonArray|readJsonObject|readState)\s*\(/],
 ['DIRECT_MEMORY_FILE_IO',/\b(?:readFileSync|readFile|createReadStream)\s*\([^;\n]{0,500}(?:memory\.json|knowledge\.json|conversations\.json|work-learning-records\.json|work-knowledge-consolidation\.json)/i],
 ['GENERIC_STORE_LOADER',/\bloadStore\s*\(/],
 ['PROVIDER_OR_SNAPSHOT_READ',/\b(?:loadMemoryFromDrive|loadKnowledgeFromDrive|loadDriveState|readSnapshot|verifySnapshot|createSnapshot|restoreSnapshot)\s*\(/],
 ['CRM_CONVERSATION_READ',/\b(?:getConversation|listConversations|getMessage|listMessages|getContext)\s*\(/],
 ['WORK_LEARNING_OR_EXPERIENCE_READ',/\b(?:getLearningRecord|listLearningRecords|getLessons|listLessons|getExperience|listExperiences|getExperienceStats|retrieveExperiences|getExperiencesForTask|getRetrievalStats)\s*\(/],
 ['WORK_KNOWLEDGE_READ',/\b(?:getConsolidatedKnowledge|getConsolidationStats|findExistingProposal|verifyStoreIntegrity|getConsolidationItems|listConsolidationItems|searchConsolidatedKnowledge|getWorkKnowledge)\s*\(/]
];
const ALIASED_READ_CATEGORY='ALIASED_DOMAIN_READ';
const READ_EXPORTS=new Set([
 'getMemory','getKnowledge','getKnowledgeStats','getMemoryStats','searchKnowledge','searchMemory',
 'loadMemory','loadKnowledge','readJsonArray','readJsonObject','readState','loadMemoryFromDrive',
 'loadKnowledgeFromDrive','loadDriveState','readSnapshot','verifySnapshot','createSnapshot','restoreSnapshot',
 'getConversation','listConversations','getMessage','listMessages','getContext','getLearningRecord',
 'listLearningRecords','getLessons','listLessons','getExperience','listExperiences','getExperienceStats',
 'retrieveExperiences','getExperiencesForTask','getRetrievalStats','getConsolidatedKnowledge',
 'getConsolidationStats','findExistingProposal','verifyStoreIntegrity','getConsolidationItems',
 'listConsolidationItems','searchConsolidatedKnowledge','getWorkKnowledge','loadStore'
]);
function importedReadAliases(source){
 const aliases=new Map();
 const declarations=[
  /(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/gs,
  /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gs
 ];
 for(const pattern of declarations){
  pattern.lastIndex=0;
  let match;
  while((match=pattern.exec(String(source)))){
   const specifier=match[2];
   if(!/(memory|knowledge|conversation|learning|experience|work-knowledge|google-drive|snapshot|state-store|crm)/i.test(specifier)) continue;
   for(const item of match[1].split(',')){
    const parts=item.trim().split(/\s+as\s+|:\s*/);
    const original=parts[0].trim();
    const alias=(parts[1]||original).trim();
    if(READ_EXPORTS.has(original)&&alias&&alias!==original) aliases.set(alias,original);
   }
  }
 }
 return aliases;
}
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
 const aliases=importedReadAliases(source);
 for(let i=0;i<lines.length;i++){
  if(/^\s*(?:\/\/|\*|\*\/)/.test(lines[i])) continue;
  for(const [alias,original] of aliases){
   const call=new RegExp('\\b'+alias+'\\s*\\(');
   if(call.test(lines[i])) matches.push({line:i+1,category:ALIASED_READ_CATEGORY,excerpt:original+' as '+alias+': '+lines[i].trim().slice(0,180)});
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
 console.log('MIRA_HFM_'+ALIASED_READ_CATEGORY+'_COUNT='+findings.filter(x=>x.category===ALIASED_READ_CATEGORY).length);
 const byFile=new Map();
 for(const item of findings){
  const key=item.file+'|'+item.category;
  byFile.set(key,(byFile.get(key)||0)+1);
  console.log('MIRA_HFM_ACCESS_CANDIDATE='+item.file+':'+item.line+':'+item.category+':'+item.excerpt);
 }
 for(const [key,count] of [...byFile.entries()].sort((a,b)=>a[0].localeCompare(b[0]))) console.log('MIRA_HFM_ACCESS_FILE_SUMMARY='+key+':'+count);
 console.log('STATIC_CANDIDATE_SCAN_ONLY=YES');
 console.log('SEMANTIC_REVIEW_REQUIRED=YES');
 console.log('RUNTIME_DATA_ACCESSED=NO');
 console.log('NETWORK_REQUESTS=0');
}
module.exports={classifySource,scan,RULES,ALIASED_READ_CATEGORY,importedReadAliases};
