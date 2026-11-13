const { readJson } = require("../http/body");
const service = require("./service");

async function list(req, res) {
  res.end(JSON.stringify(await service.listInvoices(req.user)));
}

async function show(req, res) {
  res.end(JSON.stringify(await service.getInvoice(req.user, req.url.split("/").pop())));
}

async function create(req, res) {
  const invoice = await service.createInvoice(req.user, await readJson(req));
  res.statusCode = 201;
  res.end(JSON.stringify(invoice));
}

module.exports = { list, show, create };
