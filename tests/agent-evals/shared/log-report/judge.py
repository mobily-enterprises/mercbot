import json
got = json.load(open("report.json")); exp = json.load(open("expected.json"))
assert got["top_ips"] == exp["top_ips"], got["top_ips"]
assert got["server_errors_by_path"] == exp["server_errors_by_path"], got["server_errors_by_path"]
print("ok")
