const fs = require("fs");
const path = require("path");

const CDN_SAVE_DIRECTORY =
  process.env.CDN_SAVE_DIRECTORY || "/var/www/cdn";
const CDN_ALLOWED_IP =
  process.env.CDN_ALLOWED_IP || "194.238.23.60";

if (!fs.existsSync(CDN_SAVE_DIRECTORY)) {
  fs.mkdirSync(CDN_SAVE_DIRECTORY, { recursive: true });
}

const fsp = fs.promises;

function sanitizeFilename(filename = "") {
  const base = path.basename(String(filename));
  return base.replace(/\s+/g, "_");
}

function extractBufferFromBase64(base64 = "") {
  if (!base64) throw new Error("Missing base64 payload");
  const matches = base64.match(/^data:.*;base64,(.*)$/);
  const data = matches ? matches[1] : base64;
  return Buffer.from(data, "base64");
}

async function saveBufferToCdn(buffer, filename) {
  const safeName = sanitizeFilename(filename);
  const savePath = path.join(CDN_SAVE_DIRECTORY, safeName);
  await fsp.mkdir(path.dirname(savePath), { recursive: true });
  await fsp.writeFile(savePath, buffer);
  return savePath;
}

async function saveFileToCdn(filePath, fileName) {
  const buffer = await fsp.readFile(filePath);
  return saveBufferToCdn(buffer, fileName);
}

async function saveBase64ToCdn(base64, fileName) {
  const buffer = extractBufferFromBase64(base64);
  return saveBufferToCdn(buffer, fileName);
}

function getCleanClientIp(req) {
  const clientIP = req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || "";
  const parsed = Array.isArray(clientIP) ? clientIP[0] : clientIP;
  return parsed ? parsed.replace("::ffff:", "") : "";
}

module.exports = {
  CDN_ALLOWED_IP,
  CDN_SAVE_DIRECTORY,
  extractBufferFromBase64,
  getCleanClientIp,
  saveBase64ToCdn,
  saveBufferToCdn,
  saveFileToCdn,
  sanitizeFilename,
};
