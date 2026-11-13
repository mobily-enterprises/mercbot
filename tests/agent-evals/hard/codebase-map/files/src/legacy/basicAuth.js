// HTTP basic auth from version 1. Kept only for reference while the old admin tool is retired;
// nothing mounts it any more.
const { query } = require("../db/pool");
const { checkPassword } = require("../auth/passwords");

async function basicAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const [email, password] = Buffer.from(header.replace(/^Basic /, ""), "base64").toString().split(":");
  const { rows } = await query("select * from users where email = $1", [email]);
  if (!rows[0] || !checkPassword(password, rows[0].password_hash)) {
    res.statusCode = 401;
    return res.end();
  }
  req.user = rows[0];
  next();
}

module.exports = { basicAuth };
