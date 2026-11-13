const crypto = require("node:crypto");
const config = require("../config/payments");
const providers = require("./providers");
const { bus } = require("../events/bus");
const { HttpError } = require("../http/errors");

// Each provider signs its webhooks its own way.
function verifySignature(providerName, req, body) {
  switch (providerName) {
    case "stripe": {
      const expected = crypto.createHmac("sha256", config.stripe.webhookSecret).update(body).digest("hex");
      return String(req.headers["stripe-signature"] || "").includes(expected);
    }
    case "paypal":
      return req.headers["paypal-transmission-id"] && req.headers["paypal-auth-algo"] && config.paypal.webhookId;
    default:
      return false;
  }
}

async function handleWebhook(providerName, req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!verifySignature(providerName, req, body)) throw new HttpError(400, "Bad signature");
  const payment = providers.get(providerName).parseWebhook(body);
  if (payment) bus.emit("payment.received", { ...payment, provider: providerName });
}

module.exports = { handleWebhook, verifySignature };
