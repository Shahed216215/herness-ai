"use strict";

const ATTACHMENT_KEYS = /^(?:attachment|attachments|filecontent|file_content|filedata|file_data|filepayload|file_payload|filebytes|file_bytes|filebase64|file_base64|base64|basedata|uploadcontent|uploaddata|uploadpayload)$/i;
const DATA_URI_BASE64 = /^data:[^,\s]+;base64,/i;

function containsExplicitAttachmentPayload(value, depth = 0) {
  if (depth > 20 || value === null || value === undefined) return false;

  if (typeof value === "string") {
    return DATA_URI_BASE64.test(value.trim());
  }

  if (Array.isArray(value)) {
    return value.some(item => containsExplicitAttachmentPayload(item, depth + 1));
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (ATTACHMENT_KEYS.test(key)) return true;
      if (containsExplicitAttachmentPayload(child, depth + 1)) return true;
    }
  }

  return false;
}

module.exports = function rejectUnsupportedUploads(req, res, next) {
  const contentType = String(req.headers?.["content-type"] || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (contentType === "multipart/form-data") {
    return res.status(415).json({
      error: "Multipart uploads are not supported by this service"
    });
  }

  // This middleware runs both before and after express.json().
  // Inspect parsed JSON only; never buffer or parse request streams here.
  if (
    contentType === "application/json" &&
    req.body &&
    typeof req.body === "object" &&
    containsExplicitAttachmentPayload(req.body)
  ) {
    return res.status(415).json({
      error: "Attachment payloads are not supported by this service"
    });
  }

  return next();
};

module.exports.containsExplicitAttachmentPayload =
  containsExplicitAttachmentPayload;
