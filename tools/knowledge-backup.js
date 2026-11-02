const fs = require("fs");
const path = require("path");

const { getKnowledge } = require("../knowledge");

const BASE_DIR = path.join(__dirname, "..");

const CREDENTIALS_PATH = path.join(
  BASE_DIR,
  "client_secret.json"
);

const TOKEN_PATH = path.join(
  BASE_DIR,
  "google-token.json"
);

const KNOWLEDGE_FILE = path.join(
  BASE_DIR,
  "knowledge.json"
);

const FOLDER_NAME = "Mira AI Knowledge";
const BACKUP_FILE_NAME = "knowledge-backup.json";

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }

  try {
    return JSON.parse(
      fs.readFileSync(filePath, "utf8")
    );
  } catch {
    throw new Error(`Invalid JSON in ${label}: ${filePath}`);
  }
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
      "Invalid Google OAuth client JSON"
    );
  }

  const { client_id, client_secret } = config;

  const auth = new google.auth.OAuth2(
    client_id,
    client_secret,
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

  const folder = await drive.files.create({
    requestBody: {
      name: FOLDER_NAME,
      mimeType:
        "application/vnd.google-apps.folder"
    },
    fields: "id"
  });

  if (!folder.data.id) {
    throw new Error(
      "Failed to create Google Drive folder"
    );
  }

  return folder.data.id;
}

async function createBackup() {
  const knowledge = getKnowledge();

  if (!Array.isArray(knowledge)) {
    throw new Error(
      "Knowledge data is not an array."
    );
  }

  const backup = {
    backupVersion: 1,
    createdAt: new Date().toISOString(),
    source: "Mira knowledge.json",
    entryCount: knowledge.length,
    entries: knowledge
  };

  fs.writeFileSync(
    KNOWLEDGE_FILE,
    JSON.stringify(knowledge, null, 2),
    "utf8"
  );

  const backupPath = path.join(
    BASE_DIR,
    BACKUP_FILE_NAME
  );

  const backupContent = JSON.stringify(
    backup,
    null,
    2
  );

  fs.writeFileSync(
    backupPath,
    backupContent,
    "utf8"
  );

  const drive = await getDrive();
  const folderId = await getFolderId(drive);

  const existing = await drive.files.list({
    q:
      `'${folderId}' in parents ` +
      `and name='${BACKUP_FILE_NAME}' ` +
      `and trashed=false`,
    spaces: "drive",
    fields: "files(id,name)"
  });

  let driveAction;

  if (
    existing.data.files &&
    existing.data.files.length > 0
  ) {
    const fileId =
      existing.data.files[0].id;

    await drive.files.update({
      fileId,
      requestBody: {
        name: BACKUP_FILE_NAME,
        mimeType: "application/json"
      },
      media: {
        mimeType: "application/json",
        body: backupContent
      }
    });

    driveAction = "updated";
  } else {
    const created =
      await drive.files.create({
        requestBody: {
          name: BACKUP_FILE_NAME,
          parents: [folderId],
          mimeType: "application/json"
        },
        media: {
          mimeType: "application/json",
          body: backupContent
        },
        fields: "id,name"
      });

    driveAction = "created";
  }

  return {
    success: true,
    action: "backup",
    entriesBackedUp: knowledge.length,
    localBackup: BACKUP_FILE_NAME,
    driveSync: true,
    driveAction
  };
}

module.exports = {
  name: "knowledge_backup",

  declaration: {
    name: "knowledge_backup",
    description:
      "Create a separate backup of Mira's knowledge.json and synchronize that backup file to Google Drive without modifying the knowledge base.",
    parameters: {
      type: "object",
      properties: {}
    }
  },

  execute: async () => {
    const result = await createBackup();

    return JSON.stringify(
      result,
      null,
      2
    );
  }
};
