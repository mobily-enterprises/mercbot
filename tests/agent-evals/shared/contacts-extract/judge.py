import json
got = json.load(open("contacts.json"))
assert got["emails"] == ["billing@acme.example", "dana.smith@example.com", "ops@acme.example", "tom_w@post.example"], got["emails"]
assert got["phones"] == ["+61412345678", "+61893001234", "+61893004321"], got["phones"]
print("ok")
