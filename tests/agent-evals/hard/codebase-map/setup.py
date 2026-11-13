# Adds the project's ordinary business modules (each a routes, service and repository file) to the
# workspace (argv[1]), and src/modules.js, which mounts them. They make the project a realistic
# size; nothing the questions ask about lives in them.
import os, sys
ws = sys.argv[1]
MODULES = {
    "products": ("product", "products", ["name", "sku", "unit_price"]),
    "suppliers": ("supplier", "suppliers", ["name", "email", "abn"]),
    "inventory": ("stock item", "stock_items", ["product_id", "warehouse_id", "quantity"]),
    "warehouses": ("warehouse", "warehouses", ["name", "address"]),
    "shipments": ("shipment", "shipments", ["customer_id", "carrier", "tracking_code"]),
    "expenses": ("expense", "expenses", ["description", "amount", "spent_on"]),
    "projects": ("project", "projects", ["name", "customer_id", "budget"]),
    "timesheets": ("timesheet entry", "timesheet_entries", ["project_id", "hours", "worked_on"]),
    "quotes": ("quote", "quotes", ["customer_id", "total", "valid_until"]),
    "reports": ("report", "saved_reports", ["name", "query", "schedule"]),
}
def write(rel, text):
    path = os.path.join(ws, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write(text)
for module, (noun, table, fields) in MODULES.items():
    cols = ", ".join(fields)
    marks = ", ".join(f"${i + 2}" for i in range(len(fields)))
    write(f"src/{module}/routes.js", f'''const {{ createRouter }} = require("../http/router");
const {{ readJson }} = require("../http/body");
const service = require("./service");

const router = createRouter();
router.get("/{module}", async (req, res) => res.end(JSON.stringify(await service.list(req.user))));
router.post("/{module}", async (req, res) => res.end(JSON.stringify(await service.add(req.user, await readJson(req)))));
router.patch("/{module}/:id", async (req, res) => res.end(JSON.stringify(await service.change(req.user, req.url.split("/").pop(), await readJson(req)))));
module.exports = router;
''')
    write(f"src/{module}/service.js", f'''const repository = require("./repository");
const {{ HttpError }} = require("../http/errors");

const REQUIRED = {fields[:1]!r};

async function list(user) {{
  return repository.listByCompany(user.company_id);
}}

// A new {noun}, once its required fields are there.
async function add(user, input) {{
  for (const field of REQUIRED) if (input[field] === undefined || input[field] === "") throw new HttpError(400, `A {noun} needs ${{field}}`);
  return repository.insert(user.company_id, input);
}}

async function change(user, id, input) {{
  const existing = await repository.find(user.company_id, id);
  if (!existing) throw new HttpError(404, "No such {noun}");
  return repository.update(user.company_id, id, {{ ...existing, ...input }});
}}

module.exports = {{ list, add, change }};
'''.replace("{fields[:1]!r}", str(fields[:1]).replace("'", '"')))
    write(f"src/{module}/repository.js", f'''const {{ query }} = require("../db/pool");

async function listByCompany(companyId) {{
  return (await query("select * from {table} where company_id = $1 order by id", [companyId])).rows;
}}

async function find(companyId, id) {{
  return (await query("select * from {table} where company_id = $1 and id = $2", [companyId, id])).rows[0] || null;
}}

async function insert(companyId, input) {{
  const {{ rows }} = await query("insert into {table} (company_id, {cols}) values ($1, {marks}) returning *", [companyId, {", ".join(f"input.{f}" for f in fields)}]);
  return rows[0];
}}

async function update(companyId, id, record) {{
  const {{ rows }} = await query("update {table} set {", ".join(f"{f} = ${i + 3}" for i, f in enumerate(fields))} where company_id = $1 and id = $2 returning *", [companyId, id, {", ".join(f"record.{f}" for f in fields)}]);
  return rows[0];
}}

module.exports = {{ listByCompany, find, insert, update }};
''')
write("src/modules.js", "// The plain business modules, mounted under /api by app.js.\nmodule.exports = " + str(list(MODULES)).replace("'", '"') + ";\n")
