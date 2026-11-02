const fs = require("fs");
const path = require("path");
const storagePath = require('./mira-storage');
const crypto = require("crypto");

const USERS_FILE = storagePath("users.json");

function ensureUsersFile() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(
      USERS_FILE,
      "[]\n",
      { mode: 0o600 }
    );
  }
}

function loadUsers() {
  ensureUsersFile();

  try {
    const raw = fs.readFileSync(
      USERS_FILE,
      "utf8"
    );

    const users = JSON.parse(raw);

    return Array.isArray(users)
      ? users
      : [];
  } catch (error) {
    throw new Error(
      `Unable to read users database: ${error.message}`
    );
  }
}

function saveUsers(users) {
  fs.writeFileSync(
    USERS_FILE,
    JSON.stringify(users, null, 2) + "\n",
    { mode: 0o600 }
  );
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function normalizeUsername(username) {
  return username.trim();
}

function validateUsername(username) {
  return /^[A-Za-z0-9_]{3,32}$/.test(
    username
  );
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    email
  );
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);

  const hash = crypto.scryptSync(
    password,
    salt,
    64
  );

  return {
    algorithm: "scrypt",
    salt: salt.toString("hex"),
    hash: hash.toString("hex")
  };
}

function verifyPassword(password, stored) {
  if (
    !stored ||
    stored.algorithm !== "scrypt" ||
    typeof stored.salt !== "string" ||
    typeof stored.hash !== "string"
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(
      stored.salt,
      "hex"
    );

    const expectedHash = Buffer.from(
      stored.hash,
      "hex"
    );

    const actualHash = crypto.scryptSync(
      password,
      salt,
      expectedHash.length
    );

    if (
      actualHash.length !==
      expectedHash.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      actualHash,
      expectedHash
    );
  } catch {
    return false;
  }
}

function createUser({
  email,
  username,
  password
}) {
  if (
    typeof email !== "string" ||
    typeof username !== "string" ||
    typeof password !== "string"
  ) {
    return {
      success: false,
      error: "Email, username and password are required."
    };
  }

  const normalizedEmail =
    normalizeEmail(email);

  const normalizedUsername =
    normalizeUsername(username);

  if (!validateEmail(normalizedEmail)) {
    return {
      success: false,
      error: "Please enter a valid email address."
    };
  }

  if (
    !validateUsername(
      normalizedUsername
    )
  ) {
    return {
      success: false,
      error:
        "Username must be 3-32 characters and use only letters, numbers or underscore."
    };
  }

  if (password.length < 8) {
    return {
      success: false,
      error:
        "Password must be at least 8 characters."
    };
  }

  const users = loadUsers();

  const usernameExists = users.some(
    user =>
      user.username.toLowerCase() ===
      normalizedUsername.toLowerCase()
  );

  if (usernameExists) {
    return {
      success: false,
      error: "Username is already registered."
    };
  }

  const emailExists = users.some(
    user =>
      user.email.toLowerCase() ===
      normalizedEmail
  );

  if (emailExists) {
    return {
      success: false,
      error: "Email is already registered."
    };
  }

  const passwordData =
    hashPassword(password);

  const user = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    username: normalizedUsername,
    password: passwordData,
    role: "user",
    createdAt: new Date().toISOString()
  };

  users.push(user);
  saveUsers(users);

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      createdAt: user.createdAt
    }
  };
}

function authenticateUser(
  username,
  password
) {
  if (
    typeof username !== "string" ||
    typeof password !== "string"
  ) {
    return null;
  }

  const users = loadUsers();

  const user = users.find(
    item =>
      item.username.toLowerCase() ===
      username.trim().toLowerCase()
  );

  if (!user) {
    return null;
  }

  if (
    !verifyPassword(
      password,
      user.password
    )
  ) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: "user"
  };
}

function getUserCount() {
  return loadUsers().length;
}

module.exports = {
  createUser,
  authenticateUser,
  getUserCount
};
