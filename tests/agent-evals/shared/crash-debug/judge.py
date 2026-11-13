import subprocess
out = subprocess.run(["python3", "stats.py", "data.csv"], capture_output=True, text=True)
assert out.returncode == 0 and out.stdout.strip() == "count=3 mean=20.00 median=20.00", out
out = subprocess.run(["python3", "stats.py", "empty.csv"], capture_output=True, text=True)
assert out.returncode == 0 and out.stdout.strip() == "count=0", out
print("ok")
