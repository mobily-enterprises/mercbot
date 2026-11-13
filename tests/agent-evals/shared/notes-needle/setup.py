import random, json, sys, os
ws, judge = sys.argv[1], sys.argv[2]
random.seed(9)
os.makedirs(f"{ws}/notes")
filler = ["We reviewed the roadmap.", "Action items were assigned.", "The budget was discussed briefly.", "No decisions on hiring.", "Next sync in two weeks.", "Marketing shared an update."]
facts = {12: "The launch date was moved to 14 March.", 23: "Priya will own the vendor contract.", 31: "The office lease ends on 30 June."}
for n in range(1, 41):
    lines = [f"# Meeting {n}", f"Date: 2026-{(n % 9) + 1:02d}-{(n % 27) + 1:02d}", ""] + random.sample(filler * 4, 18)
    if n in facts: lines.insert(random.randint(4, len(lines)), facts[n])
    open(f"{ws}/notes/meeting-{n:02d}.md", "w").write("\n".join(lines) + "\n")
json.dump({"launch": "14 March", "vendor": "Priya", "lease": "30 June", "files": ["meeting-12.md", "meeting-23.md", "meeting-31.md"]}, open(f"{judge}/expected.json", "w"))
