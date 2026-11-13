const { createRouter } = require("../http/router");
const controller = require("./controller");

const router = createRouter();
router.get("/invoices", controller.list);
router.get("/invoices/:id", controller.show);
router.post("/invoices", controller.create);
module.exports = router;
