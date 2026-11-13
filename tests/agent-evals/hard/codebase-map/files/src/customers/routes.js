const { createRouter } = require("../http/router");
const { readJson } = require("../http/body");
const service = require("./service");

const router = createRouter();
router.get("/customers", async (req, res) => res.end(JSON.stringify(await service.listCustomers(req.user))));
router.post("/customers", async (req, res) => res.end(JSON.stringify(await service.addCustomer(req.user, await readJson(req)))));
module.exports = router;
