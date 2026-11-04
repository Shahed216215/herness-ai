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
 ['CACHE_OR_INDEX_ACCESS,/\b(?:memory|knowledge|conversation|learning|experience)[\w$]*(?:cache|embedding|vector|index)[\w$]*\b|\b(?:cache|embedding|embeddings|vectorStore|vectorIndex|searchIndex)\b/i],
 ['EXPORT_ARCHIVE_OPERATION,/\b(?:export|dump|archive)(?:Memory|Knowledge|Conversation|Learning|Experience|Records?)\b|\b(?:Memory|Knowledge|Conversation|Learning|Experience)(?:Export|Dump|Archive)\b/i],
 ['BACKUP_RESTORE_OPERATION,/\b(?:createBackup|restoreMemory|createKnowledgeBackup|restoreKnowledge|restoreVersion|listVersions|verifyVersion|backupMemory|backupKnowledge|createSnapshot|verifySnapshot|restoreSnapshot)\s*\(/i],
 ['PROVIDER_MEMORY_WRITE,/\b(?:saveMemoryToDrive|saveKnowledgeToDrive)\s*\(/]
];
const ALIASED_READ_CATEGORY='ALIASED_DOMAIN_READ';
const NAMESPACE_READ_CATEGORY='NAMESPACE_DOMAIN_READ';
const RELEVANT_MODULE=/(memory|knowledge|conversation|learning|experience|work-knowledge|google-drive|snapshot|state-store|crm)/i;
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
   if(!RELEVANT_MODULE.test(specifier)) continue;
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
function importedNamespaceAliases(source){
 const aliases=new Map();
 const declarations=[
  /(?:const|let|var)\s+(\w+)\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/gs,
  /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gs,
  /(?:const|let|var)\s+(\w+)\s*=\s*(?:await\s*)?import\(\s*['"]([^'"]+)['"]\s*\)/gs
 ];
 for(const pattern of declarations){
  pattern.lastIndex=0;
  let match;
  while((match=pattern.exec(String(source)))){
   if(RELEVANT_MODULE.test(match[2])) aliases.set(match[1],match[2]);
  }
 }
 return aliases;
}
function classifySource(relativePath,source){
 const sourceLines=String(source).split(/\r?\n/);
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
 const namespaces=importedNamespaceAliases(source);
 const exportedNames=[...READ_EXPORTS].join('|');
 for(let i=0;i<lines.length;i++){
  if(/^\s*(?:\/\/|\*|\*\/)/.test(lines[i])) continue;
  for(const [alias,specifier] of namespaces){
   const member=new RegExp('\\b'+alias+'\\s*\\.\\s*('+exportedNames+')\\s*\\(');
   const found=member.exec(lines[i]);
   if(found) matches.push({line:i+1,category:NAMESPACE_READ_CATEGORY,excerpt:specifier+' namespace '+alias+'.'+found[1]+': '+lines[i].trim().slice(0,160)});
  }
 }
 const canonicalFilePattern=/(?:memory\.json|knowledge\.json|conversations\.json|work-learning-records\.json|work-knowledge-consolidation\.json)/i;
 const canonicalPathVariables=new Set();
 for(const line of sourceLines){
  if(/^\s*(?:\/\/|\*|\*\/)/.test(line)) continue;
  const declaration=/(?:const|let|var)\s+(\w+)\s*=\s*[^;\n]{0,300}/i.exec(line);
  if(declaration&&canonicalFilePattern.test(line)) canonicalPathVariables.add(declaration[1]);
 }
 for(let i=0;i<sourceLines.length;i++){
  const line=sourceLines[i];
  if(/^\s*(?:\/\/|\*|\*\/)/.test(line)) continue;
  const read=/\b(?:readFileSync|readFile|createReadStream|readJsonArray|readJsonObject|readState)\s*\(([^)]{0,500})\)/.exec(line);
  if(!read) continue;
  const directPath=canonicalFilePattern.test(read[1]);
  const linkedVariable=[...canonicalPathVariables].some(name=>new RegExp('\\b'+name+'\\b').test(read[1]));
  if(directPath||linkedVariable){
   matches.push({line:i+1,category:'CANONICAL_STORE_FILE_BACKED_READ',excerpt:line.trim().slice(0,180)});
  }
 }
 const backgroundPath=/(?:^|[\\/])[^/\\]*(?:worker|queue|job)[^/\\]*\.(?:js|cjs|mjs|ts)$/i.test(relativePath);
 const memoryCategories=new Set(['PUBLIC_OR_INTERNAL_RETRIEVAL','DIRECT_STORE_READ','DIRECT_MEMORY_FILE_IO','GENERIC_STORE_LOADER','PROVIDER_OR_SNAPSHOT_READ','CRM_CONVERSATION_READ','WORK_LEARNING_OR_EXPERIENCE_READ','WORK_KNOWLEDGE_READ',ALIASED_READ_CATEGORY,NAMESPACE_READ_CATEGORY,'CANONICAL_STORE_FILE_BACKED_READ']);
 if(backgroundPath&&matches.some(item=>memoryCategories.has(item.category))) matches.push({line:0,category:'BACKGROUND_WORKER_DOMAIN_ACCESS',excerpt:'Worker/queue/job source contains a Memory/Knowledge/Conversation/Learning access candidate.'});
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
 console.log('MIRA_HFM_'+NAMESPACE_READ_CATEGORY+'_COUNT='+findings.filter(x=>x.category===NAMESPACE_READ_CATEGORY).length);
 console.log('MIRA_HFM_CANONICAL_STORE_FILE_BACKED_READ_COUNT='+findings.filter(x=>x.category==='CANONICAL_STORE_FILE_BACKED_READ').length);
 console.log('MIRA_HFM_BACKGROUND_WORKER_DOMAIN_ACCESS_COUNT='+findings.filter(x=>x.category==='BACKGROUND_WORKER_DOMAIN_ACCESS').length);
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
module.exports={classifySource,scan,RULES,ALIASED_READ_CATEGORY,NAMESPACE_READ_CATEGORY,importedReadAliases,importedNamespaceAliases};
