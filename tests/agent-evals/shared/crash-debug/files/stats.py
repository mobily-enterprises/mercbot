import sys, csv, statistics
def summarise(path):
    rows = list(csv.DictReader(open(path)))
    values = [float(r["value"]) for r in rows]
    return {"count": len(values), "mean": statistics.mean(values), "median": statistics.median(values)}
if __name__ == "__main__":
    s = summarise(sys.argv[1])
    print(f"count={s['count']} mean={s['mean']:.2f} median={s['median']:.2f}")
