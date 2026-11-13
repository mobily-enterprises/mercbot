# Facts about the project that only reading the code gets right: the README is out of date, a
# legacy auth module isn't mounted, and the SMS listener is switched off.
import json, os, re

def clean(path):
    return re.sub(r"^(\./|/files/mine/)", "", str(path).strip())

def fn(step):
    return str(step).split("#")[-1].strip().rstrip("()")

answers = json.load(open("answers.json"))
problems = []

auth = answers.get("auth", {})
if clean(auth.get("file", "")) != "src/auth/middleware.js" or auth.get("function") != "requireSession":
    problems.append(f"auth: {auth}")
check = auth.get("session_check", {})
if clean(check.get("file", "")) != "src/auth/sessions.js" or check.get("function") != "verifySession":
    problems.append(f"session_check: {check}")

steps = [fn(step) for step in answers.get("invoice_steps", [])]
order = ["createInvoice", "validateInvoiceInput", "computeTotals", "insertInvoice", "insertLines"]
position = 0
for step in steps:
    if position < len(order) and step == order[position]:
        position += 1
if position < len(order):
    problems.append(f"invoice_steps miss or misorder {order[position]}: {steps}")
else:
    last_save = max(index for index, step in enumerate(steps) if step == "insertLines")
    for listener in ("postInvoiceToLedger", "emailInvoice"):
        if listener not in steps[last_save:]:
            problems.append(f"invoice_steps: {listener} missing after the save")
if "smsInvoice" in steps:
    problems.append("invoice_steps include the disabled SMS listener")

if sorted(answers.get("invoice_tables", [])) != ["email_outbox", "invoice_lines", "invoices", "ledger_entries"]:
    problems.append(f"invoice_tables: {answers.get('invoice_tables')}")

provider = sorted(clean(path) for path in answers.get("new_payment_provider", []))
for needed in ("src/config/payments.js", "src/payments/providers/index.js", "src/payments/webhooks.js"):
    if needed not in provider:
        problems.append(f"new_payment_provider misses {needed}: {provider}")
stray = [path for path in provider if not re.match(r"^(src/payments/|src/config/|README\.md$|tests/|db/|\.env)", path)]
if stray:
    problems.append(f"new_payment_provider includes unrelated files: {stray}")

if not os.path.exists("ARCHITECTURE.md") or len(open("ARCHITECTURE.md").read()) < 300:
    problems.append("ARCHITECTURE.md missing or too short")
else:
    text = open("ARCHITECTURE.md").read()
    if "requireSession" not in text:
        problems.append("ARCHITECTURE.md doesn't mention requireSession")
    if not re.search(r"invoice[._ ]created", text, re.IGNORECASE):
        problems.append("ARCHITECTURE.md doesn't mention the invoice-created event")

assert not problems, "\n".join(problems)
print("ok")
