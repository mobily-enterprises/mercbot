import json
got = json.load(open("answers.json")); exp = json.load(open("expected.json"))
assert int(got["orders_au"]) == exp["orders_au"], got
assert got["top_customer"] == exp["top_customer"], got
assert got["busiest_month"] == exp["busiest_month"], got
assert abs(float(got["avg_order_nz"]) - exp["avg_order_nz"]) < 0.006, got
print("ok")
