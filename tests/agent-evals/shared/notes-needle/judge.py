import json
got = json.load(open("answers.json")); exp = json.load(open("expected.json"))
for key in ("launch", "vendor", "lease"): assert exp[key].lower() in str(got[key]).lower(), (key, got[key])
# The prompt allows one sorted list, or the files per fact.
files = got["files"]
names = sorted(sum(files.values(), []) if isinstance(files, dict) and all(isinstance(v, list) for v in files.values()) else list(files.values()) if isinstance(files, dict) else files)
assert names == exp["files"], files
print("ok")
