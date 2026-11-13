const crypto = require("node:crypto");

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), crypto.scryptSync(password, salt, 64));
}

module.exports = { hashPassword, checkPassword };
