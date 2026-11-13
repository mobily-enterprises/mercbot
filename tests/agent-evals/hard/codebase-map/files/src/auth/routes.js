const { createRouter } = require("../http/router");
const { readJson } = require("../http/body");
const { query } = require("../db/pool");
const { checkPassword } = require("./passwords");
const { createSession, endSession } = require("./sessions");
const { readCookie } = require("./middleware");
const { HttpError } = require("../http/errors");

const router = createRouter();

router.post("/login", async (req, res) => {
  const { email, password } = await readJson(req);
  const { rows } = await query("select * from users where email = $1", [String(email).toLowerCase()]);
  if (!rows[0] || !checkPassword(String(password), rows[0].password_hash)) throw new HttpError(401, "Wrong email or password");
  const sid = await createSession(rows[0].id);
  res.setHeader("set-cookie", `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
  res.end(JSON.stringify({ ok: true }));
});

router.post("/logout", async (req, res) => {
  const sid = readCookie(req.headers.cookie || "", "sid");
  if (sid) await endSession(sid);
  res.end(JSON.stringify({ ok: true }));
});

module.exports = router;
