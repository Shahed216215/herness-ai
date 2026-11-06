"use strict";
const assert=require("node:assert/strict");
const {validateWorkflowInput}=require("../services/mira-marketing-workflow-orchestrator");
const brief={clientId:"test-client",clientName:"Test Client",websiteUrl:"https://example.test/",industry:"Software",businessType:"SaaS",targetMarket:{countryCode:"BD",countryName:"Bangladesh"},targetLanguage:"bn-BD",primaryGoals:[],keywords:[]};
const result=validateWorkflowInput({brief,query:"primary query",competitorQueries:["extra query"],confirmedCompetitorDomains:["example.org"]},{getClientProfile:()=>null});
assert.deepEqual(result.competitorQueries,["extra query"]);
assert.deepEqual(result.confirmedCompetitorDomains,["example.org"]);
assert.throws(()=>validateWorkflowInput({brief,query:"primary query",competitorQueries:new Array(6).fill("x")},{getClientProfile:()=>null}),/COMPETITOR_QUERIES_INVALID/);
console.log("MARKETING_WORKFLOW_COMPETITOR_INPUT_TEST_STATUS=PASS");
