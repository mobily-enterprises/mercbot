const { createRouter } = require("./http/router");
const { requestLog } = require("./http/logging");
const { handleErrors } = require("./http/errors");
const { requireSession } = require("./auth/middleware");
const { bus } = require("./events/bus");
const { registerListeners } = require("./events/listeners");
const extraModules = require("./modules");

// The whole API: logging first, then the login routes (open), then everything under /api, which
// needs a signed-in user.
function createApp() {
  const app = createRouter();
  app.use(requestLog);
  app.use(require("./auth/routes"));
  app.use("/api", requireSession);
  app.use("/api", require("./customers/routes"));
  app.use("/api", require("./invoices/routes"));
  app.use("/api", require("./payments/routes"));
  for (const name of extraModules) app.use("/api", require(`./${name}/routes`));
  app.use(handleErrors);
  registerListeners(bus);
  return app;
}

module.exports = { createApp };
