const crypto = require("crypto");

const {
  authenticateUser
} = require("./users");

const USERNAME =
  process.env.MIRA_USER_USERNAME || "user";

const ADMIN_USERNAME =
  process.env.MIRA_ADMIN_USERNAME || "admin";

const USER_PASSWORD =
  process.env.MIRA_USER_PASSWORD;

const ADMIN_PASSWORD =
  process.env.MIRA_ADMIN_PASSWORD;

function safeEqual(a, b) {
  if (
    typeof a !== "string" ||
    typeof b !== "string"
  ) {
    return false;
  }

  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  if (
    aBuffer.length !==
    bBuffer.length
  ) {
    return false;
  }

  return crypto.timingSafeEqual(
    aBuffer,
    bBuffer
  );
}

function authenticateLogin(
  username,
  password
) {
  if (
    typeof username !== "string" ||
    typeof password !== "string"
  ) {
    return null;
  }

  const cleanUsername =
    username.trim();

  /*
   * ADMIN LOGIN
   *
   * Admin credentials remain controlled
   * by the protected .env configuration.
   */
  if (
    ADMIN_PASSWORD &&
    cleanUsername === ADMIN_USERNAME &&
    safeEqual(
      password,
      ADMIN_PASSWORD
    )
  ) {
    return {
      role: "admin",
      username: ADMIN_USERNAME
    };
  }

  /*
   * REGISTERED USER LOGIN
   *
   * User credentials are stored as a
   * secure password hash in users.json.
   */
  const registeredUser =
    authenticateUser(
      cleanUsername,
      password
    );

  if (registeredUser) {
    return {
      role: "user",
      userId: registeredUser.id,
      username: registeredUser.username,
      email: registeredUser.email
    };
  }

  /*
   * LEGACY USER LOGIN
   *
   * Keep the existing configured user
   * temporarily so existing access is not
   * unexpectedly broken during migration.
   */
  if (
    USER_PASSWORD &&
    cleanUsername === USERNAME &&
    safeEqual(
      password,
      USER_PASSWORD
    )
  ) {
    return {
      role: "user",
      username: USERNAME
    };
  }

  return null;
}

function requireSession(
  req,
  res,
  next
) {
  if (
    !req.session ||
    !req.session.authenticated
  ) {
    return res.status(401).json({
      success: false,
      error: "Login required."
    });
  }

  req.role =
    req.session.role;

  next();
}

function requireAdminSession(
  req,
  res,
  next
) {
  if (
    !req.session ||
    !req.session.authenticated
  ) {
    return res.status(401).json({
      success: false,
      error: "Login required."
    });
  }

  if (
    req.session.role !== "admin"
  ) {
    return res.status(403).json({
      success: false,
      error:
        "Admin access required."
    });
  }

  req.role = "admin";

  next();
}

module.exports = {
  authenticateLogin,
  requireSession,
  requireAdminSession
};
