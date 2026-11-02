const {
  ROLES,
  PERMISSIONS,
  hasPermission,
  getPermissions
} = require("./permissions");

function authenticate(req, res, next) {
  const userToken = process.env.MIRA_ACCESS_TOKEN;
  const adminToken = process.env.MIRA_ADMIN_TOKEN;

  if (!userToken || !adminToken) {
    return res.status(500).json({
      success: false,
      error: "Authentication is not configured correctly."
    });
  }

  const authorization = req.headers.authorization || "";

  if (!authorization.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "Authentication required."
    });
  }

  const token = authorization.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Authentication required."
    });
  }

  if (token === adminToken) {
    req.role = ROLES.ADMIN;
    req.permissions = getPermissions(ROLES.ADMIN);
    return next();
  }

  if (token === userToken) {
    req.role = ROLES.USER;
    req.permissions = getPermissions(ROLES.USER);
    return next();
  }

  return res.status(401).json({
    success: false,
    error: "Invalid authentication token."
  });
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.role) {
      return res.status(401).json({
        success: false,
        error: "Authentication required."
      });
    }

    if (!hasPermission(req.role, permission)) {
      return res.status(403).json({
        success: false,
        error: "Permission denied.",
        required_permission: permission,
        role: req.role
      });
    }

    next();
  };
}

function requireAdmin(req, res, next) {
  return requirePermission(PERMISSIONS.SYSTEM_ADMIN)(
    req,
    res,
    next
  );
}

function getIdentity(req) {
  return {
    role: req.role || null,
    permissions: req.permissions || []
  };
}

module.exports = {
  authenticate,
  requirePermission,
  requireAdmin,
  getIdentity
};
