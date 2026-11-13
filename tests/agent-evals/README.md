# Agent evaluations (D-48)

Real tasks for bots, judged by their outcome, not by the reply's wording. `shared/` holds the cases
both our loop and DeepSeek Harness (the reference, run outside the app) can do with only Python's
standard library and Node. Each case has:

- `prompt.md`: what the person asks.
- `files/`: the starting workspace (test files inside it end in `.fixture`, removed on copy, so the app's own `npm test` skips them).
- `setup.py`: optional; writes generated inputs to the workspace and hidden answers to the judge folder.
- `hidden/`: optional; answers the judge needs, never shown to the agent.
- `judge.py` or `judge.test.mjs`: run in the workspace after the agent finishes; exit 0 passes.

Runners write traces to `artifacts/agent-evals/<run>/` (not committed).
