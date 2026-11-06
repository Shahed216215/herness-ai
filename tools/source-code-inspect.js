"use strict";
const fs=require("node:fs"), path=require("node:path");
const ROOT=path.resolve(__dirname,".."), MAX_FILE_BYTES=49152, MAX_OUTPUT_CHARS=16000;
const ALLOWLIST=Object.freeze(["package.json","server.js","tools/index.js","tools/project-connection-audit.js","services/tool-runner.js","services/mira-work-execution-engine.js","memory.js","knowledge.js","mira-storage.js","services/mira-local-memory-store.js","providers/index.js"]);
function redactSource(input){
 let out=String(input);
 out=out.replace(/-----BEGIN(?: RSA| EC| OPENSSH)? PRIVATE KEY-----[\s\S]*?-----END(?: RSA| EC| OPENSSH)? PRIVATE KEY-----/g,"[REDACTED_PRIVATE_KEY]");
 out=out.replace(/\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|authorization|bearer)\b\s*[:=]\s*)(["']?)[^"'\s,;]+/gi,"$1[REDACTED]");
 out=out.replace(/\b(Bearer)\s+[A-Za-z0-9._~+\/-]{12,}/gi,"$1 [REDACTED]");
 out=out.replace(/\bAKIA[0-9A-Z]{16}\b/g,"[REDACTED_AWS_KEY]");
 out=out.replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi,"$1[REDACTED]@");
 return out;
}
function inspectSource(file){
 if(!ALLOWLIST.includes(file)) return {ok:false,status:"PATH_NOT_ALLOWLISTED"};
 const absolute=path.resolve(ROOT,file), rel=path.relative(ROOT,absolute);
 if(!rel||rel.startsWith("..")||path.isAbsolute(rel)) return {ok:false,status:"UNSAFE_PATH"};
 try{
  const st=fs.lstatSync(absolute);
  if(st.isSymbolicLink()||!st.isFile()) return {ok:false,status:"NOT_A_SAFE_REGULAR_FILE"};
  if(st.size>MAX_FILE_BYTES) return {ok:false,status:"FILE_TOO_LARGE"};
  const raw=fs.readFileSync(absolute,"utf8"), content=redactSource(raw);
  return {ok:true,file,bytes:st.size,content:content.slice(0,MAX_OUTPUT_CHARS),truncated:content.length>MAX_OUTPUT_CHARS,redactionApplied:content!==raw};
 }catch(e){return {ok:false,status:e.code==="ENOENT"?"FILE_NOT_FOUND":"FILE_UNREADABLE"};}
}
module.exports={name:"source_code_inspect",declaration:{name:"source_code_inspect",description:"Read-only inspection of one allowlisted Mira source/configuration file. Fixed paths only; bounded output and common credential redaction. No shell, arbitrary paths, writes, network, or deployment.",parameters:{type:"object",properties:{file:{type:"string",enum:ALLOWLIST,description:"Exact allowlisted project-relative file path."}},required:["file"],additionalProperties:false}},execute:async(args={})=>{const r=inspectSource(args.file);return JSON.stringify({tool:"source_code_inspect",status:r.ok?"READ_ONLY_SOURCE_RETURNED":r.status,...r,scope:{allowlistOnly:true,maxFileBytes:MAX_FILE_BYTES,maxOutputChars:MAX_OUTPUT_CHARS,shellExecuted:false,networkRequests:0,filesModified:false,deploymentAttempted:false}},null,2);},_internals:{ALLOWLIST,redactSource,inspectSource}};
