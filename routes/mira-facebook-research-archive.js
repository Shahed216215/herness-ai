'use strict';

const {
  CONFIRMATION,
  archiveResearchEvidenceWithHumanApproval
} = require('../services/mira-facebook-research-archive-approval');

function registerMiraFacebookResearchArchiveRoutes(
  app,
  requireAdminPermission,
  PERMISSIONS,
  options = {}
) {
  const archiveApproved = options.archiveApproved || archiveResearchEvidenceWithHumanApproval;

  app.post(
    '/api/admin/facebook-research-archive/import',
    requireAdminPermission(PERMISSIONS.SYSTEM_ADMIN),
    async (req, res) => {
      const session = req.session;
      const actor = session && typeof session.username === 'string'
        ? session.username.trim()
        : '';

      if (
        !session ||
        session.authenticated !== true ||
        session.role !== 'admin' ||
        !actor
      ) {
        return res.status(403).json({
          success: false,
          status: 'BLOCKED',
          code: 'NAMED_ADMIN_BROWSER_SESSION_REQUIRED'
        });
      }

      const body = req.body && typeof req.body === 'object' ? req.body : {};
      if (body.confirmArchiveImport !== CONFIRMATION) {
        return res.status(403).json({
          success: false,
          status: 'BLOCKED',
          code: 'RESEARCH_ARCHIVE_CONFIRMATION_REQUIRED'
        });
      }

      try {
        const result = await archiveApproved({
          actor,
          confirmed: true,
          pageId: body.pageId,
          pageName: body.pageName,
          evidence: body.evidence
        });

        if (result.status === 'ARCHIVE_WRITE_VERIFIED_AUDIT_INCOMPLETE') {
          return res.status(503).json({
            success: false,
            ...result,
            code: 'RESEARCH_ARCHIVE_AUDIT_INCOMPLETE',
            retrySafe: false
          });
        }

        return res.status(200).json({
          success: true,
          ...result
        });
      } catch (error) {
        const code = /^[A-Za-z0-9_-]{1,64}$/.test(String(error && error.code || ''))
          ? String(error.code)
          : 'RESEARCH_ARCHIVE_IMPORT_FAILED';
        const status = code === 'RESEARCH_ARCHIVE_POLICY_DENIED' ? 403
          : code === 'RESEARCH_ARCHIVE_INVALID_INPUT' ||
            code === 'RESEARCH_ARCHIVE_ACTOR_REQUIRED' ||
            code === 'RESEARCH_ARCHIVE_CONFIRMATION_REQUIRED' ? 400
            : 503;
        return res.status(status).json({
          success: false,
          status: 'FAILED',
          code,
          canonicalMemoryWrite: false
        });
      }
    }
  );
}

module.exports = registerMiraFacebookResearchArchiveRoutes;
