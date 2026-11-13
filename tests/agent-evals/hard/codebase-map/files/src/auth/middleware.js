const { verifySession } = require("./sessions");
const { HttpError } = require("../http/errors");

// Every /api request goes through here: the session cookie must name a live session, whose user
// becomes req.user.
async function requireSession(req, res, next) {
  const sid = readCookie(req.headers.cookie || "", "sid");
  if (!sid) throw new HttpError(401, "Sign in first");
  const user = await verifySession(sid);
  if (!user) throw new HttpError(401, "Your session has expired");
  req.user = user;
  next();
}

function readCookie(header, name) {
  const match = header.split(/;\s*/).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

module.exports = { requireSession, readCookie };
