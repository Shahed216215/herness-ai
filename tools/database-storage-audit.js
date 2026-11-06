"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const ROOT=path.resolve(__dirname,".."),MAX_BYTES=10*1024*1024;
const ENV_KEYS=["DATABASE_URL","DB_URL","POSTGRES_URL","PGHOST","MYSQL_URL","MONGODB_URI","SUPABASE_URL","SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY"];
const SOURCE_FILES=["package.json","server.js","memory.js","knowledge.js","google-drive.js","mira-storage.js"];
const DB_DEPS=["pg","postgres","@supabase/supabase-js","better-sqlite3","sqlite3","mysql2","mongoose"];
const MARKERS=[/\bnew\s+(?:Pool|Client)\s*\(/,/\bcreateClient\s*\(/,/\bmongoose\.connect\s*\(/,/\bbetter-sqlite3\b/,/\bsqlite3\.Database\b/,/\bmysql2?\b/];
function inspectStore(file,eligible){
 if(!eligible)return {status:"CUSTOM_STORAGE_CONFIGURED_NOT_INSPECTED"};
 try{
  const full=path.resolve(ROOT,file),st=fs.lstatSync(full);
  if(st.isSymbolicLink()||!st.isFile())return {status:"UNSAFE_OR_NOT_REGULAR_FILE"};
  if(st.size>MAX_BYTES)return {status:"STORE_TOO_LARGE"};
  const raw=fs.readFileSync(full,"utf8"),parsed=JSON.parse(raw);
  if(!Array.isArray(parsed))return {status:"INVALID_TOP_LEVEL_SCHEMA"};
  return {status:"READ_ONLY_METADATA_VERIFIED",entries:parsed.length,bytes:st.size,sha256:crypto.createHash("sha256").update(raw).digest("hex")};
 }catch(e){if(e.code==="ENOENT")return {status:"NOT_FOUND"};if(e instanceof SyntaxError)return {status:"INVALID_JSON"};return {status:"READ_ERROR"};}
}
function audit(){
 let deps={},packageStatus="UNAVAILABLE";
 try{const f=path.join(ROOT,"package.json"),st=fs.lstatSync(f);if(!st.isSymbolicLink()&&st.isFile()&&st.size<=MAX_BYTES){const p=JSON.parse(fs.readFileSync(f,"utf8"));deps={...(p.dependencies||{}),...(p.devDependencies||{})};packageStatus="READ";}}catch(_){}
 const databaseDependencies=DB_DEPS.filter(x=>Object.hasOwn(deps,x)),sourceFiles=[],markers=[];
 for(const file of SOURCE_FILES){try{const full=path.join(ROOT,file),st=fs.lstatSync(full);if(st.isSymbolicLink()||!st.isFile()||st.size>MAX_BYTES){sourceFiles.push({file,status:"UNSAFE_OR_TOO_LARGE"});continue;}const content=fs.readFileSync(full,"utf8");sourceFiles.push({file,status:"READ"});if(MARKERS.some(rx=>rx.test(content)))markers.push(file);}catch(e){sourceFiles.push({file,status:e.code==="ENOENT"?"NOT_FOUND":"READ_ERROR"});}}
 const configuredEnvironmentNames=ENV_KEYS.filter(k=>typeof process.env[k]==="string"&&process.env[k].length>0);
 const customStorageConfigured=Boolean(process.env.MIRA_STORAGE_DIR),customMemoryFileConfigured=Boolean(process.env.MIRA_MEMORY_FILE);
 const stores={memory:inspectStore("memory.json",!customStorageConfigured&&!customMemoryFileConfigured),knowledge:inspectStore("knowledge.json",!customStorageConfigured)};
 const adapter=databaseDependencies.length>0||markers.length>0;
 return {tool:"database_storage_audit",status:adapter?"DATABASE_ADAPTER_CANDIDATE_FOUND_REQUIRES_CONFIGURATION_REVIEW":"DATABASE_NOT_CONFIRMED_LOCAL_JSON_STORAGE_ONLY",database:{adapterDependencies:databaseDependencies,sourceFilesInspected:sourceFiles,connectionMarkersFoundIn:markers,configuredEnvironmentVariableNames,environmentValuesReturned:false,remoteConnectionAttempted:false,schemaQueryAttempted:false},localStorage:{backend:"JSON_FILES",stores,customStorageConfigured,customMemoryFileConfigured},scope:{readOnly:true,databaseWrites:0,filesystemWrites:0,networkRequests:0,secretsReturned:false,arbitraryPathsAccepted:false},limitations:["Static inspection only; no remote database connection or SQL query is performed.","Configured environment names do not prove a working database connection.","Custom storage paths are intentionally not opened."]};
}
module.exports={name:"database_storage_audit",declaration:{name:"database_storage_audit",description:"Read-only audit of local JSON memory/knowledge storage and statically configured database adapters. Metadata, counts and hashes only; no records, secret values, remote connections or writes.",parameters:{type:"object",properties:{},additionalProperties:false}},execute:async()=>JSON.stringify(audit(),null,2),_internals:{audit,inspectStore}};
