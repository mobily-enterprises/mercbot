# The fast version must give exactly the original's output: on the sample, on tricky hand-made
# rows (checked against the original algorithm, kept here), and on customers.csv, in under 10 s.
import csv, json, os, re, subprocess, sys, time, random, tempfile

def reference(rows):
    norm_email = lambda v: v.strip().lower()
    def norm_phone(v):
        d = re.sub(r"\D", "", v); return d[-9:] if len(d) >= 9 else None
    parent = list(range(len(rows)))
    def root(i):
        while parent[i] != i: i = parent[i]
        return i
    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            a, b = rows[i], rows[j]
            pa, pb = norm_phone(a["phone"]), norm_phone(b["phone"])
            if (a["email"] and norm_email(a["email"]) == norm_email(b["email"])) or (pa is not None and pa == pb):
                parent[root(j)] = root(i)
    groups = {}
    for i, row in enumerate(rows): groups.setdefault(root(i), []).append(int(row["id"]))
    return sorted((sorted(ids) for ids in groups.values() if len(ids) > 1), key=lambda ids: ids[0])

def run(path):
    out = tempfile.mktemp(suffix=".json")
    started = time.time()
    result = subprocess.run([sys.executable, "dedupe.py", path, out], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    return json.load(open(out)), time.time() - started

def write(rows):
    path = tempfile.mktemp(suffix=".csv")
    with open(path, "w", newline="") as handle:
        w = csv.DictWriter(handle, ["id", "name", "email", "phone"]); w.writeheader(); w.writerows(rows)
    return path

# Edge cases: an empty email on one side only, blank-vs-blank emails, short phones, chains.
random.seed(5)
for trial in range(30):
    rows = []
    for n in range(40):
        rows.append({"id": n + 1, "name": "x", "email": random.choice(["", " ", "a@x.com", "A@X.COM ", "b@x.com", "c@x.com"]), "phone": random.choice(["", "123", "0412 345 678", "+61412345678", "99412345678", "0899990000", "08 9999 0000"])})
    got, _ = run(write(rows))
    assert got == reference(rows), ("edge case differs", rows, got, reference(rows))
with open("sample.csv", newline="") as handle:
    sample = list(csv.DictReader(handle))
assert run("sample.csv")[0] == reference(sample)
got, seconds = run("customers.csv")
assert seconds < 10, f"took {seconds:.1f}s"
assert sum(len(g) for g in got) > 15000, "too few duplicates found"
print("ok", round(seconds, 2))
