# The invoices main.py writes must match the rules exactly, run fresh from the fixed code.
import json, os, shutil, subprocess, sys
shutil.rmtree("invoices", ignore_errors=True)
run = subprocess.run([sys.executable, "main.py", "usage-2026-03.csv", "2026-03"], capture_output=True, text=True)
assert run.returncode == 0, run.stderr
expected = json.load(open("expected.json"))
written = {name[:-5]: json.load(open(os.path.join("invoices", name))) for name in os.listdir("invoices")}
assert sorted(written) == sorted(expected), (sorted(written), sorted(expected))
for customer, invoice in expected.items():
    got = written[customer]
    assert got["units"] == invoice["units"] and abs(got["total"] - invoice["total"]) < 0.005 and got["month"] == "2026-03", (customer, got, invoice)
print("ok")
