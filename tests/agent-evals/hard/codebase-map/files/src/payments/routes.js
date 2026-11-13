const { createRouter } = require("../http/router");
const { readJson } = require("../http/body");
const service = require("./service");
const { handleWebhook } = require("./webhooks");

const router = createRouter();
router.post("/payments/checkout", async (req, res) => {
  const { invoiceId, provider } = await readJson(req);
  res.end(JSON.stringify(await service.startCheckout(req.user, invoiceId, provider)));
});
router.post("/payments/webhook/:provider", async (req, res) => {
  await handleWebhook(req.url.split("/").pop(), req);
  res.end("ok");
});
module.exports = router;
