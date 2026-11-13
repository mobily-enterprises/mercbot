# Writes customers.json and the March usage into the workspace (argv[1]) and the expected invoices
# into the judge folder (argv[2]), from the rules in RULES.md.
import json, random, sys
random.seed(7)
ws, judge = sys.argv[1], sys.argv[2]
customers = [{"id": f"c{n:02d}", "plan": "tiered" if n % 3 else "flat"} for n in range(1, 13)]
json.dump(customers, open(f"{ws}/customers.json", "w"), indent=2)
rows = []
for c in customers:
    for d in ["2026-02-28", "2026-03-01", "2026-03-15", "2026-03-31", "2026-04-01"]:
        if random.random() < 0.8:
            rows.append((c["id"], d, random.choice([random.randint(5, 900), random.randint(900, 4000)])))
rows.append(("c07", "2026-03-31", 2600)); rows.append(("c07", "2026-03-10", 1900))
random.shuffle(rows)
with open(f"{ws}/usage-2026-03.csv", "w") as out:
    out.write("customer,date,units\n")
    for c, d, u in rows:
        out.write(f'{c},{d},"{u:,}"\n' if u >= 1000 else f"{c},{d},{u}\n")
def price(plan, u):
    if plan == "flat": return u * 0.10
    return min(u, 1000) * 0.10 + max(0, min(u, 5000) - 1000) * 0.08 + max(0, u - 5000) * 0.05
plans = {c["id"]: c["plan"] for c in customers}
totals = {}
for c, d, u in rows:
    if d.startswith("2026-03"): totals[c] = totals.get(c, 0) + u
expected = {c: {"customer": c, "month": "2026-03", "units": u, "total": round(price(plans[c], u), 2)} for c, u in totals.items()}
json.dump(expected, open(f"{judge}/expected.json", "w"))
