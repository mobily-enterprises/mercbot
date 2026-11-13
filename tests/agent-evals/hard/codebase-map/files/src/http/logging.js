// One log line per request.
function requestLog(req, res, next) {
  const started = Date.now();
  res.on("finish", () => console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`));
  next();
}

module.exports = { requestLog };
