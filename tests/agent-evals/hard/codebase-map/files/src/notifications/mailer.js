const { query } = require("../db/pool");
const config = require("../config");

// Emails are queued; a separate worker sends them.
async function queueEmail(to, subject, body) {
  await query("insert into email_outbox (sender, recipient, subject, body) values ($1, $2, $3, $4)", [config.mailFrom, to, subject, body]);
}

module.exports = { queueEmail };
