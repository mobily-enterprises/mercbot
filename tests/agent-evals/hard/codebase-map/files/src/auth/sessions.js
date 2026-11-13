const crypto = require("node:crypto");
const { query } = require("../db/pool");
const config = require("../config");

async function createSession(userId) {
  const sid = crypto.randomBytes(32).toString("hex");
  await query("insert into sessions (id, user_id, expires_at) values ($1, $2, now() + ($3 || ' days')::interval)", [sid, userId, config.sessionDays]);
  return sid;
}

// The user a session belongs to, if it exists and hasn't expired.
async function verifySession(sid) {
  const { rows } = await query("select u.* from sessions s join users u on u.id = s.user_id where s.id = $1 and s.expires_at > now()", [sid]);
  return rows[0] || null;
}

async function endSession(sid) {
  await query("delete from sessions where id = $1", [sid]);
}

module.exports = { createSession, verifySession, endSession };
