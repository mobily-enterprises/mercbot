import subprocess, unittest, os, json
def run(*args):
    r = subprocess.run(["python3", "todo.py", *args], capture_output=True, text=True)
    return r.returncode, r.stdout.strip()
class J(unittest.TestCase):
    def test_flow(self):
        if os.path.exists("todo.json"): os.remove("todo.json")
        self.assertEqual(run("list"), (0, "Nothing to do"))
        self.assertEqual(run("add", "milk"), (0, "Added 1"))
        self.assertEqual(run("add", "bread", "--due", "2026-11-02"), (0, "Added 2"))
        self.assertEqual(run("list"), (0, "1 milk\n2 bread (due 2026-11-02)"))
        self.assertEqual(run("done", "1"), (0, "Done 1"))
        self.assertEqual(run("remove", "2"), (0, "Removed 2"))
        self.assertEqual(run("add", "eggs"), (0, "Added 3"))
        self.assertEqual(run("done", "9")[0], 1)
        self.assertEqual(run("stats"), (0, "1 open, 1 done"))
if __name__ == "__main__": unittest.main()
