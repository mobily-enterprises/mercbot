import csv, json
orders = json.load(open("orders.json"))["orders"]
expected = [[o["id"], o["customer"]["name"], o["customer"]["city"], it["sku"], str(it["qty"]), f'{it["price"]:.2f}', f'{it["qty"]*it["price"]:.2f}'] for o in orders for it in o["items"]]
rows = list(csv.reader(open("lines.csv")))
assert rows[0] == ["order_id","customer","city","sku","qty","price","line_total"], rows[0]
got = [[r[0], r[1], r[2], r[3], str(int(float(r[4]))), f"{float(r[5]):.2f}", f"{float(r[6]):.2f}"] for r in rows[1:]]
assert got == expected, (got[:3], expected[:3])
print("ok")
