const ROLES = {
  USER: "user",
  ADMIN: "admin"
};

const PERMISSIONS = {
  CHAT: "chat",
  BASIC_TOOLS: "basic_tools",

  CYBER_SECURITY: "cyber_security",
  RED_TEAM: "red_team",
  BLUE_TEAM: "blue_team",
  PURPLE_TEAM: "purple_team",
  PENTESTING: "pentesting",

  TOOL_DEVELOPMENT: "tool_development",
  SELF_UPDATE: "self_update",

  VIDEO_EDITING: "video_editing",
  AUTONOMOUS_LEARNING: "autonomous_learning",

  CLIENT_PROJECTS: "client_projects",

  KNOWLEDGE_ADMIN: "knowledge_admin",
  MEMORY_ADMIN: "memory_admin",
  CAPACITY_ADMIN: "capacity_admin",
  SYSTEM_ADMIN: "system_admin",

  AUDIT_LOG: "audit_log",
  BACKUP_RESTORE: "backup_restore"
};

const ROLE_PERMISSIONS = {
  [ROLES.USER]: [
    PERMISSIONS.CHAT,
    PERMISSIONS.BASIC_TOOLS
  ],

  [ROLES.ADMIN]: Object.values(PERMISSIONS)
};

function hasPermission(role, permission) {
  if (!role || !permission) {
    return false;
  }

  const permissions =
    ROLE_PERMISSIONS[role];

  if (!permissions) {
    return false;
  }

  return permissions.includes(permission);
}

function getPermissions(role) {
  return ROLE_PERMISSIONS[role] || [];
}

module.exports = {
  ROLES,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  hasPermission,
  getPermissions
};
