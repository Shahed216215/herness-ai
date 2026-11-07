const { assertLegacyStorageDisabled } = require("../services/mira-hfm-legacy-storage-guard");
const fs = require("fs");
const path = require("path");

const BASE_DIR = path.join(__dirname, "..");

const KNOWLEDGE_FILE = path.join(
  BASE_DIR,
  "knowledge.json"
);

const BACKUP_FILE = path.join(
  BASE_DIR,
  "knowledge-backup.json"
);

const CREDENTIALS_PATH = path.join(
  BASE_DIR,
  "client_secret.json"
);

const TOKEN_PATH = path.join(
  BASE_DIR,
  "google-token.json"
);

const FOLDER_NAME = "Mira AI Knowledge";
const BACKUP_FILE_NAME = "knowledge-backup.json";
const KNOWLEDGE_FILE_NAME = "knowledge.json";

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }

  try {
    return JSON.parse(
      fs.readFileSync(filePath, "utf8")
    );
  } catch {
    throw new Error(
      `Invalid JSON in ${label}: ${filePath}`
    );
  }
}

function validateBackup(backup) {
  if (!backup || typeof backup !== "object") {
    throw new Error("Invalid backup format.");
  }

  if (backup.backupVersion !== 1) {
    throw new Error("Unsupported backup version.");
  }

  if (!Array.isArray(backup.entries)) {
    throw new Error(
      "Backup entries are not a valid array."
    );
  }

  return backup.entries;
}

async function getDrive() {
  const { google } = require("googleapis");
  const credentials = readJson(
    CREDENTIALS_PATH,
    "Google OAuth credentials"
  );

  const tokens = readJson(
    TOKEN_PATH,
    "Google OAuth token"
  );

  const config =
    credentials.installed || credentials.web;

  if (!config) {
    throw new Error(
      "Invalid Google OAuth client JSON."
    );
  }

  if (!config.client_id || !config.client_secret) {
    throw new Error(
      "Google OAuth client_id or client_secret is missing."
    );
  }

  const auth = new google.auth.OAuth2(
    config.client_id,
    config.client_secret,
    "http://localhost:3000"
  );

  auth.setCredentials(tokens);

  return google.drive({
    version: "v3",
    auth
  });
}

async function getFolderId(drive) {
  const result = await drive.files.list({
    q:
      `name='${FOLDER_NAME}' ` +
      `and mimeType='application/vnd.google-apps.folder' ` +
      `and trashed=false`,
    spaces: "drive",
    fields: "files(id,name)"
  });

  if (
    result.data.files &&
    result.data.files.length > 0
  ) {
    return result.data.files[0].id;
  }

  throw new Error(
    `Google Drive folder "${FOLDER_NAME}" was not found.`
  );
}

async function loadBackupFromDrive() {
  const drive = await getDrive();
  const folderId = await getFolderId(drive);

  const result = await drive.files.list({
    q:
      `'${folderId}' in parents ` +
      `and name='${BACKUP_FILE_NAME}' ` +
      `and trashed=false`,
    spaces: "drive",
    orderBy: "modifiedTime desc",
    fields: "files(id,name,modifiedTime)"
  });

  if (
    !result.data.files ||
    result.data.files.length === 0
  ) {
    throw new Error(
      "No knowledge backup found on Google Drive."
    );
  }

  const fileId =
    result.data.files[0].id;

  const response = await drive.files.get({
    fileId,
    alt: "media"
  });

  return response.data;
}

async function syncKnowledgeToDrive(knowledge) {
  const drive = await getDrive();
  const folderId = await getFolderId(drive);

  const content = JSON.stringify(
    knowledge,
    null,
    2
  );

  const existing = await drive.files.list({
    q:
      `'${folderId}' in parents ` +
      `and name='${KNOWLEDGE_FILE_NAME}' ` +
      `and trashed=false`,
    spaces: "drive",
    fields: "files(id,name)"
  });

  if (
    existing.data.files &&
    existing.data.files.length > 0
  ) {
    const fileId =
      existing.data.files[0].id;

    await drive.files.update({
      fileId,
      requestBody: {
        name: KNOWLEDGE_FILE_NAME,
        mimeType: "application/json"
      },
      media: {
        mimeType: "application/json",
        body: content
      }
    });

    return "updated";
  }

  await drive.files.create({
    requestBody: {
      name: KNOWLEDGE_FILE_NAME,
      parents: [folderId],
      mimeType: "application/json"
    },
    media: {
      mimeType: "application/json",
      body: content
    },
    fields: "id,name"
  });

  return "created";
}

async function restoreFromBackup() {
  let backup;
  let source;

  if (fs.existsSync(BACKUP_FILE)) {
    backup = readJson(
      BACKUP_FILE,
      "Local knowledge backup"
    );

    source = "local backup";
  } else {
    backup = await loadBackupFromDrive();

    source = "Google Drive backup";
  }

  const entries = validateBackup(backup);

  let currentKnowledge = [];

  if (fs.existsSync(KNOWLEDGE_FILE)) {
    currentKnowledge = readJson(
      KNOWLEDGE_FILE,
      "Current knowledge"
    );
  }

  if (!Array.isArray(currentKnowledge)) {
    currentKnowledge = [];
  }

  const safetyBackup = {
    backupVersion: 1,
    createdAt: new Date().toISOString(),
    source: "Before Mira knowledge restore",
    entryCount: currentKnowledge.length,
    entries: currentKnowledge
  };

  const safetyBackupPath = path.join(
    BASE_DIR,
    "knowledge-before-restore.json"
  );

  fs.writeFileSync(
    safetyBackupPath,
    JSON.stringify(
      safetyBackup,
      null,
      2
    ),
    "utf8"
  );

  fs.writeFileSync(
    KNOWLEDGE_FILE,
    JSON.stringify(
      entries,
      null,
      2
    ),
    "utf8"
  );

  let driveSync = false;
  let driveAction = null;

  try {
    driveAction =
      await syncKnowledgeToDrive(entries);

    driveSync = true;
  } catch (error) {
    return {
      success: true,
      action: "restore",
      restoredEntries: entries.length,
      source,
      safetyBackup:
        "knowledge-before-restore.json",
      driveSync: false,
      driveError: error.message,
      message:
        "Knowledge base restored locally, but Google Drive synchronization failed."
    };
  }

  return {
    success: true,
    action: "restore",
    restoredEntries: entries.length,
    source,
    safetyBackup:
      "knowledge-before-restore.json",
    driveSync,
    driveAction,
    message:
      "Knowledge base restored successfully and synchronized to Google Drive."
  };
}

module.exports = {
  name: "knowledge_restore",

  declaration: {
    name: "knowledge_restore",
    description:
      "Restore Mira's knowledge base from a verified backup and synchronize the restored knowledge.json to Google Drive. Only perform the restore when the user explicitly confirms it.",
    parameters: {
      type: "object",
      properties: {
        confirm: {
          type: "boolean",
          description:
            "Must be true to perform the restore."
        }
      },
      required: ["confirm"]
    }
  },

  execute: async ({ confirm }) => {
    assertLegacyStorageDisabled();
    if (confirm !== true) {
      return JSON.stringify({
        success: false,
        restored: false,
        dataModified: false,
        message:
          "Restore not performed. Explicit confirmation is required."
      });
    }

    const result =
      await restoreFromBackup();

    return JSON.stringify(
      result,
      null,
      2
    );
  }
};
