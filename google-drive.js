const path = require("path");
const { assertLegacyStorageDisabled } = require('./services/mira-hfm-legacy-storage-guard');
t path = require("path");

const BASE_DIR = __dirname;

const CREDENTIALS_PATH = fs.existsSync(
  path.join(BASE_DIR, "client_secret.json")
)
  ? path.join(BASE_DIR, "client_secret.json")
  : path.join("/etc/secrets", "client_secret.json");

const TOKEN_PATH = fs.existsSync(
  path.join(BASE_DIR, "google-token.json")
)
  ? path.join(BASE_DIR, "google-token.json")
  : path.join("/etc/secrets", "google-token.json");

const KNOWLEDGE_FOLDER_NAME = "Mira AI Knowledge";
const KNOWLEDGE_FILE_NAME = "knowledge.json";

const MEMORY_FOLDER_NAME = "Mira AI Memory";
const MEMORY_FILE_NAME = "memory.json";

function readJson(filePath, label) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} not found: ${filePath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
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

  const config = credentials.installed || credentials.web;

  if (!config) {
    throw new Error("Invalid Google OAuth client JSON");
  }

  const { client_id, client_secret } = config;

  if (!client_id || !client_secret) {
    throw new Error(
      "Google OAuth client_id or client_secret is missing"
    );
  }

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

async function getFolderId(drive, folderName) {
  const result = await drive.files.list({
    q:
      `name='${folderName}' ` +
      `and mimeType='application/vnd.google-apps.folder' ` +
      `and trashed=false`,
    spaces: "drive",
    fields: "files(id,name)"
  });

  if (result.data.files && result.data.files.length > 0) {
    return result.data.files[0].id;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: "application/vnd.google-apps.folder"
    },
    fields: "id"
  });

  if (!folder.data.id) {
    throw new Error(
      `Failed to create Google Drive folder: ${folderName}`
    );
  }

  return folder.data.id;
}

async function saveJsonFileToDrive(
  drive,
  folderId,
  fileName,
  data
) {
  const content = JSON.stringify(data, null, 2);

  const existing = await drive.files.list({
    q:
      `'${folderId}' in parents ` +
      `and name='${fileName}' ` +
      `and trashed=false`,
    spaces: "drive",
    fields: "files(id,name)"
  });

  if (
    existing.data.files &&
    existing.data.files.length > 0
  ) {
    const fileId = existing.data.files[0].id;

    await drive.files.update({
      fileId,
      requestBody: {
        name: fileName,
        mimeType: "application/json"
      },
      media: {
        mimeType: "application/json",
        body: content
      }
    });

    return {
      success: true,
      action: "updated",
      fileId
    };
  }

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: "application/json"
    },
    media: {
      mimeType: "application/json",
      body: content
    },
    fields: "id,name"
  });

  return {
    success: true,
    action: "created",
    fileId: created.data.id,
    name: created.data.name
  };
}

async function loadJsonFileFromDrive(
  drive,
  folderId,
  fileName
) {
  const result = await drive.files.list({
    q:
      `'${folderId}' in parents ` +
      `and name='${fileName}' ` +
      `and trashed=false`,
    spaces: "drive",
    fields: "files(id,name)"
  });

  if (
    !result.data.files ||
    result.data.files.length === 0
  ) {
    return null;
  }

  const fileId = result.data.files[0].id;

  const response = await drive.files.get({
    fileId,
    alt: "media"
  });

  return response.data;
}

async function saveKnowledgeToDrive(data) {
  assertLegacyStorageDisabled();
  if (process.env.MIRA_TEST_OFFLINE_DRIVE === "1") {
    return { success: false, skipped: true, action: "skipped_test_offline" };
  }
  const drive = await getDrive();

  const folderId = await getFolderId(
    drive,
    KNOWLEDGE_FOLDER_NAME
  );

  return saveJsonFileToDrive(
    drive,
    folderId,
    KNOWLEDGE_FILE_NAME,
    data
  );
}

async function loadKnowledgeFromDrive() {
  assertLegacyStorageDisabled();
  if (process.env.MIRA_TEST_OFFLINE_DRIVE === "1") return null;
  const drive = await getDrive();

  const folderId = await getFolderId(
    drive,
    KNOWLEDGE_FOLDER_NAME
  );

  return loadJsonFileFromDrive(
    drive,
    folderId,
    KNOWLEDGE_FILE_NAME
  );
}

async function saveMemoryToDrive(data) {
  assertLegacyStorageDisabled();
  if (process.env.MIRA_TEST_OFFLINE_DRIVE === "1") {
    return { success: false, skipped: true, action: "skipped_test_offline" };
  }
  const drive = await getDrive();

  const folderId = await getFolderId(
    drive,
    MEMORY_FOLDER_NAME
  );

  return saveJsonFileToDrive(
    drive,
    folderId,
    MEMORY_FILE_NAME,
    data
  );
}

async function loadMemoryFromDrive() {
  assertLegacyStorageDisabled();
  if (process.env.MIRA_TEST_OFFLINE_DRIVE === "1") return null;
  const drive = await getDrive();

  const folderId = await getFolderId(
    drive,
    MEMORY_FOLDER_NAME
  );

  return loadJsonFileFromDrive(
    drive,
    folderId,
    MEMORY_FILE_NAME
  );
}

module.exports = {
  saveKnowledgeToDrive,
  loadKnowledgeFromDrive,
  saveMemoryToDrive,
  loadMemoryFromDrive
};
