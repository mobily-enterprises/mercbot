import csv, json
expected = json.load(open("expected.json"))
rows = list(csv.DictReader(open("summary.csv")))
got = {r["region"]: round(float(r["total"]), 2) for r in rows}
assert got == expected, (got, expected)
assert [r["region"] for r in rows] == sorted(expected, key=lambda k: -expected[k]), "order"
print("ok")
