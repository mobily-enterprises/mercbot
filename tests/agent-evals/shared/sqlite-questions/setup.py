import sqlite3, random, json, sys
ws, judge = sys.argv[1], sys.argv[2]
random.seed(5)
db = sqlite3.connect(f"{ws}/shop.db")
db.executescript("create table customers(id integer primary key, name text, country text); create table orders(id integer primary key, customer_id int, total real, placed text);")
countries = ["AU", "NZ", "UK", "US"]
for i in range(1, 61): db.execute("insert into customers values (?,?,?)", (i, f"Customer {i}", random.choice(countries)))
for i in range(1, 601): db.execute("insert into orders values (?,?,?,?)", (i, random.randint(1, 60), round(random.uniform(10, 900), 2), f"2026-{random.randint(1,9):02d}-{random.randint(1,28):02d}"))
db.commit()
q = lambda s: db.execute(s).fetchall()
exp = {
  "orders_au": q("select count(*) from orders o join customers c on c.id=o.customer_id where c.country='AU'")[0][0],
  "top_customer": q("select c.name from orders o join customers c on c.id=o.customer_id group by c.id order by sum(o.total) desc, c.name limit 1")[0][0],
  "busiest_month": q("select substr(placed,1,7) m from orders group by m order by count(*) desc, m limit 1")[0][0],
  "avg_order_nz": round(q("select avg(o.total) from orders o join customers c on c.id=o.customer_id where c.country='NZ'")[0][0], 2)
}
json.dump(exp, open(f"{judge}/expected.json", "w"))
