const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeUsername(value) {
  return cleanString(value).replace(/^@/, "").toLowerCase();
}

function isValidUsername(value) {
  return USERNAME_PATTERN.test(value);
}

function isValidEmail(value) {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

// Returns a normalised http(s) URL, "" when empty, or null when invalid.
function parseImageUrl(value) {
  const raw = cleanString(value);
  if (!raw) return "";
  if (raw.length > 500) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

// Positive integer id from a route param or query value; null if invalid.
function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseLimit(value, fallback = 10, max = 30) {
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) return fallback;
  return Math.min(limit, max);
}

// Escape % and _ so user input is matched literally inside a LIKE pattern.
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

module.exports = { cleanString, normalizeUsername, isValidUsername, isValidEmail, parseImageUrl, parseId, parseLimit, escapeLike };
