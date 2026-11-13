"""Group customer records that are the same person.

Two records match when their emails are equal after trimming and lowercasing, or when their phone
numbers have the same last 9 digits (ignoring everything that isn't a digit; numbers with fewer than
9 digits never match). Matching is transitive: if A matches B and B matches C, all three are one group.

Usage: python3 dedupe.py customers.csv groups.json
groups.json is a list of groups with more than one record, each a sorted list of ids, the groups
sorted by their first id.
"""
import csv, json, re, sys


def norm_email(value):
    return value.strip().lower()


def norm_phone(value):
    digits = re.sub(r"\D", "", value)
    return digits[-9:] if len(digits) >= 9 else None


def same(a, b):
    if a["email"] and norm_email(a["email"]) == norm_email(b["email"]):
        return True
    pa, pb = norm_phone(a["phone"]), norm_phone(b["phone"])
    return pa is not None and pa == pb


def main(source, target):
    with open(source, newline="") as handle:
        rows = list(csv.DictReader(handle))
    parent = list(range(len(rows)))

    def root(i):
        while parent[i] != i:
            i = parent[i]
        return i

    for i in range(len(rows)):
        for j in range(i + 1, len(rows)):
            if same(rows[i], rows[j]):
                parent[root(j)] = root(i)

    groups = {}
    for i, row in enumerate(rows):
        groups.setdefault(root(i), []).append(int(row["id"]))
    result = sorted((sorted(ids) for ids in groups.values() if len(ids) > 1), key=lambda ids: ids[0])
    with open(target, "w") as handle:
        json.dump(result, handle)
    print(f"{len(result)} groups")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
