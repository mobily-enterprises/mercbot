# Writes access.log into the workspace (argv[1]) and the expected answer into the judge folder (argv[2]).
import random, json, collections, sys
random.seed(11)
ws, judge = sys.argv[1], sys.argv[2]
ips = [f"10.0.{a}.{b}" for a in range(5) for b in range(40)]
weights = [random.random() ** 3 for _ in ips]
paths = ["/", "/login", "/api/orders", "/api/items", "/static/app.js", "/health"]
lines = []; ipc = collections.Counter(); errs = collections.Counter()
for i in range(60000):
    ip = random.choices(ips, weights)[0]; st = random.choices([200, 200, 200, 301, 404, 500, 503], [50, 20, 10, 5, 8, 4, 3])[0]; p = random.choice(paths)
    ipc[ip] += 1
    if st >= 500: errs[p] += 1
    lines.append(f'{ip} - - [30/Oct/2026:{i//3600%24:02d}:{i//60%60:02d}:{i%60:02d} +0000] "GET {p} HTTP/1.1" {st} {random.randint(200,9000)}')
open(f"{ws}/access.log", "w").write("\n".join(lines) + "\n")
exp = {"top_ips": [[ip, c] for ip, c in sorted(ipc.items(), key=lambda x: (-x[1], x[0]))[:5]], "server_errors_by_path": dict(sorted(errs.items()))}
open(f"{judge}/expected.json", "w").write(json.dumps(exp))
