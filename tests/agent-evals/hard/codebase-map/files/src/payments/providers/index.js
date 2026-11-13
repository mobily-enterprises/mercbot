const config = require("../../config/payments");
const { HttpError } = require("../../http/errors");

// Every payment provider the app knows, by name.
const PROVIDERS = {
  stripe: require("./stripe"),
  paypal: require("./paypal")
};

function get(name) {
  if (!PROVIDERS[name] || !config.enabledProviders.includes(name)) throw new HttpError(400, `Payments with ${name} aren't available`);
  return PROVIDERS[name];
}

module.exports = { get, PROVIDERS };
