import json, os, sys
from usage import load_usage, in_month
from pricing import price


def main(path, month):
    with open("customers.json") as handle:
        plans = {c["id"]: c["plan"] for c in json.load(handle)}
    totals = {}
    for row in load_usage(path):
        if in_month(row["date"], month):
            totals[row["customer"]] = totals.get(row["customer"], 0) + row["units"]
    os.makedirs("invoices", exist_ok=True)
    for customer, units in sorted(totals.items()):
        invoice = {"customer": customer, "month": month, "units": units, "total": round(price(plans[customer], units), 2)}
        with open(os.path.join("invoices", f"{customer}.json"), "w") as handle:
            json.dump(invoice, handle, indent=2)
    print(f"{len(totals)} invoices written")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
