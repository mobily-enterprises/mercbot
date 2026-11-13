Build a small command-line to-do app in Python (standard library only) as todo.py, storing tasks in todo.json in the current folder:
- python3 todo.py add "text" [--due YYYY-MM-DD]  -> prints "Added 1" (the new task's id; ids start at 1 and never get reused)
- python3 todo.py list  -> one line per open task: "<id> <text>" plus " (due <date>)" when it has one, in id order; prints "Nothing to do" when empty
- python3 todo.py done <id>  -> marks it done, prints "Done <id>"; unknown id prints "No task <id>" and exits with code 1
- python3 todo.py remove <id>  -> deletes it, prints "Removed <id>"; unknown id as above
- python3 todo.py stats  -> prints "<open> open, <done> done"
Write unittest tests that run the CLI with subprocess, run them, and keep going until they pass. Plan the work before you start.
