# Writes customers.csv (60,000 rows with planted duplicates) into the workspace (argv[1]).
import csv, random, sys
random.seed(3)
ws = sys.argv[1]
rows = []
people = []
for n in range(45000):
    email = f"user{n}@mail{n % 7}.com" if random.random() < 0.9 else ""
    phone = f"04{random.randint(10000000, 99999999)}" if random.random() < 0.8 else ""
    people.append((email, phone))
for n in range(60000):
    email, phone = people[n] if n < 45000 else random.choice(people)
    if email and random.random() < 0.3: email = "  " + email.upper()
    if phone and random.random() < 0.4: phone = "+61 " + phone[1:4] + " " + phone[4:7] + " " + phone[7:]
    if n >= 45000 and random.random() < 0.5: email = ""
    if n >= 45000 and random.random() < 0.3: phone = ""
    rows.append({"id": n + 1, "name": f"Person {n}", "email": email, "phone": phone})
random.shuffle(rows)
with open(f"{ws}/customers.csv", "w", newline="") as handle:
    writer = csv.DictWriter(handle, ["id", "name", "email", "phone"]); writer.writeheader(); writer.writerows(rows)
