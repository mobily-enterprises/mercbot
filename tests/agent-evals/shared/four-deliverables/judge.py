import json, os, subprocess
for f in ("summarise.py", "test_summarise.py", "summary.json", "README.md"): assert os.path.exists(f), f
got = json.load(open("summary.json"))
assert got["Perth"] == {"min": 29, "max": 35, "mean": 31.7} or (got["Perth"]["min"] == 29 and got["Perth"]["max"] == 35 and abs(got["Perth"]["mean"] - 31.7) < 0.05), got
assert abs(got["Hobart"]["mean"] - 18.3) < 0.05, got
assert subprocess.run(["python3", "-m", "unittest", "-q"], capture_output=True).returncode == 0, "tests fail"
assert len(open("README.md").read().strip()) > 40
print("ok")
