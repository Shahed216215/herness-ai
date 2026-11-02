'use strict';

const safety = require('../services/global-safety-governance');
const flow = require('../services/autonomous-orchestrator');

function registerStage16_17Routes(
  app, requireAgentAuth, requireAgentPermission, requireAdminPermission, PERMISSIONS
) {
  if (!app || typeof app.get !== 'function' || typeof app.post !== 'function')
    throw new Error('EXPRESS_APP_REQUIRED');
  if (typeof requireAgentAuth !== 'function' ||
      typeof requireAgentPermission !== 'function' ||
      typeof requireAdminPermission !== 'function')
    throw new Error('AUTH_MIDDLEWARE_REQUIRED');
  if (!PERMISSIONS || !PERMISSIONS.CLIENT_PROJECTS)
    throw new Error('CLIENT_PROJECTS_PERMISSION_REQUIRED');

  const agent = [
    requireAgentAuth,
    requireAgentPermission(PERMISSIONS.CLIENT_PROJECTS)
  ];
  const admin = [requireAdminPermission(PERMISSIONS.CLIENT_PROJECTS)];

  function sendError(res, error) {
    const code = error && error.message || 'INTERNAL_ERROR';
    const status =
      /COMMAND_REQUIRED/.test(code) ? 400 :
      /JOB_NOT_FOUND/.test(code) ? 404 :
      /NO_PENDING_APPROVAL|JOB_TERMINAL|WORKFLOW_FINISHED/.test(code) ? 409 :
      /ORCHESTRATOR_STORE_INVALID|GOVERNANCE_DATA_INVALID|AUDIT_LOG_INVALID/.test(code) ? 503 :
      /APPROVAL_AUTHORIZATION_REQUIRED/.test(code) ? 403 : 500;
    return res.status(status).json({success:false,error:code});
  }

  app.get('/api/stage16-17/status', ...agent, (req,res) => {
    try {
      const audit = safety.verifyAudit();
      if (!audit.ok) {
        return res.status(503).json({
          success:false,error:'AUDIT_INTEGRITY_FAILURE',
          audit,emergencyStop:safety.getState().emergencyStop
        });
      }
      return res.json({
        success:true,
        capabilities:flow.capabilities(),
        workflows:flow.list(),
        governance:{state:safety.getState(),audit}
      });
    } catch (e) { return sendError(res,e); }
  });

  app.post('/api/stage16-17/workflows', ...agent, (req,res) => {
    try {
      const job=flow.create({command:req.body && req.body.command});
      return res.status(201).json({success:true,job});
    } catch (e) { return sendError(res,e); }
  });

  app.post('/api/stage16-17/workflows/:id/advance', ...agent, (req,res) => {
    try {
      const body=req.body || {};
      const result=flow.advance(req.params.id,{
        permitted:body.permitted===true,
        risk:body.risk,
        acceptanceStatus:body.acceptanceStatus,
        workScope:body.workScope,
        expectedScope:body.expectedScope,
        executionFailure:body.executionFailure===true,
        failureReason:body.failureReason,
        output:body.output,
        secretExposure:body.secretExposure===true,
        pathEscape:body.pathEscape===true,
        networkAllowed:body.networkAllowed,
        toolAllowed:body.toolAllowed,
        rateLimited:body.rateLimited===true,
        clientData:body.clientData===true,
        clientDataAllowed:body.clientDataAllowed===true
      });
      return res.json({success:true,...result});
    } catch (e) { return sendError(res,e); }
  });

  app.post('/api/stage16-17/workflows/:id/approve', ...admin, (req,res) => {
    try {
      const job=flow.approve(req.params.id,{authorized:true});
      return res.json({success:true,job});
    } catch (e) { return sendError(res,e); }
  });

  app.post('/api/stage16-17/emergency-stop', ...admin, (req,res) => {
    try {
      const result=safety.emergencyStop();
      return res.json({success:true,governance:result});
    } catch (e) { return sendError(res,e); }
  });

  app.post('/api/stage16-17/resume', ...admin, (req,res) => {
    try {
      const result=safety.resume();
      return res.json({success:true,governance:result});
    } catch (e) { return sendError(res,e); }
  });
}
module.exports=registerStage16_17Routes;
