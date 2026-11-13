import { LOOP_OUTPUT_TOKENS, REASONING, generateOnce } from "@jskit-ai/agent/server";

// The Builder's small coding loop (D-35, owner 2026-10-29: "happy for us to write a small agent
// loop"). Given a job in words, it asks the model for a script and its tests, runs the tests in the
// Apps sandbox, feeds the failures back, and stops when they pass (the script is saved) or after
// five rounds or 90 seconds (nothing is saved; the last failures come back). Each round is kept for
// the app's Logic tab. Model calls are metered like any other.
const ROUNDS = 5;
const TOTAL_MS = 90000;

export const SCRIPT_GUIDE =
  `Scripts run in a sandbox (QuickJS): plain modern JavaScript, no require/import, no timers, no fetch, no process.
Define \`async ` +
  `function main(input)\` (a function script: a plain, synchronous \`function main(arg1, arg2, …)\`, pure: no records, no ` +
  `web).
Only JSON goes in and out. Limits per run: 1 s of running time, 32 MB, 50 record calls, 5 web calls.
Record functions ` +
  `(not in functions; rules only read):
- await records.list(table, { where: "=formula over the table's fields, values in params", ` +
  `params: { name: value }, sort: "field" | "-field", limit: up to 100, page: 1 }) → [{ id, field: value, … }]
- await ` +
  `records.get(table, id) → record or null
- await records.totals(table, { groupBy: "field", sum: "field" | avg: "field", where, ` +
  `params }) → [{ key, count, total? }]
- await records.create(table, { field: value }) → record; await records.update(table, id, ` +
  `{ field: value }) → record; await records.markObsolete(table, id)
Records are by field name: links are the linked record's id, ` +
  `money is whole cents, dates are "YYYY-MM-DD", empty is null.
- await web.fetch(url, { method, headers, body }) → { status, ok, ` +
  `headers, text, json }: only https addresses on the home's allowed list; the server adds any secret headers.
- console.log(…) ` +
  `lines are kept with the run.
What main returns, by kind:
- action (a button): { notify?: "text", go?: { screen, params }, ` +
  `openDialog?: "key" }
- source (a screen's data): a list of objects (a table's rows), [{ label, value }] (totals and charts), or ` +
  `one object
- rule (before a record is saved; input { action: "create" | "update", record, previous, actor }): {} to accept, { ` +
  `refuse: "reason for the person" }, or { set: { field: value } } to fill fields in
- function: the value (number, text, yes/no, ` +
  `list or object)
- job (a timetable: input { at, every }; a watch: input { changes: [{ action, by, changed, record }], more }): ` +
  `anything (kept in the run)
Tests: [{ name, input, expect }] or [{ name, input, expectError: "part of the message" }]; for a ` +
  `function, input is the list of arguments.
A test may give records: { table: [records] } (in-memory, ids "1", "2", … unless ` +
  `given) and web: { "https://…exact url": answer JSON }.
\`expect\` must equal main's result exactly (as JSON).`;

/**
 * One round: the model's { summary, code, tests } as JSON.
 * @param {import("./types.js").ChatModel} model
 * @param {string} prompt
 */
export async function writeScriptRound(model, prompt) {
  // Writing code is building work, so it reasons (D-48).
  const text = await generateOnce({
    model,
    system:
      `You write small, correct scripts for Mercbot apps, with tests that check them.\n${SCRIPT_GUIDE}\nReply with JSON only: ` +
      `{"summary": "what it does, one sentence for people", "code": "…", "tests": [ … ]}. Between 2 and 8 tests, covering the ` +
      `normal case and the edge cases the job mentions.`,
    messages: [{ role: "user", content: prompt }],
    reasoning: REASONING.on,
    maxOutputTokens: LOOP_OUTPUT_TOKENS
  });
  return JSON.parse(String(text || "").replace(/^\s*```(?:json)?|```\s*$/gu, "").trim());
}

const describeTables = (tables) =>
  tables
    .filter((table) => !table.obsolete)
    .map(
      (table) =>
        `${table.key}: ${table.fields
          .filter((field) => !field.obsolete)
          .map(
            (field) =>
              `${field.key} (${field.type}` +
              `${field.options?.choices ? `: ${field.options.choices.join("/")}` : ""}` +
              `${field.options?.target ? ` → ${field.options.target}` : ""})`
          )
          .join(", ")}`
    )
    .join("\n");

export async function writeScript({
  scripts,
  registry,
  call,
  actor,
  app,
  key,
  kind,
  settings = {},
  job,
  examples = "",
  model,
  now = Date.now
}) {
  const started = now();
  const tables = await registry.loadTables(call);
  const appRow = await scripts.appOf(app, call);
  // The key, kind and settings come from the Builder: the model can't fix those, so check them first.
  const { errors } = scripts.checkScript({ key, kind, settings, summary: "-", code: "function main() {}", tests: [{}] }, tables);
  if (errors.length) return { status: "not saved", rounds: 0, failures: errors };
  let failures = null;
  let last = null;
  let rounds = 0;
  for (let round = 1; round <= ROUNDS; round += 1) {
    if (now() - started > TOTAL_MS) {
      failures = [...(failures || []), { error: "stopped: the 90-second limit for writing a script was reached" }];
      break;
    }
    rounds = round;
    const prompt = [
      `Kind: ${kind}. Key: ${key}.${Object.keys(settings).length ? ` Settings: ${JSON.stringify(settings)}.` : ""}`,
      `The job: ${job}`,
      examples ? `Examples from the Builder:\n${examples}` : "",
      `Tables of this home (names and types only):\n${describeTables(tables)}`,
      last
        ? `Your previous attempt:\n${JSON.stringify(last)}\nIt failed:\n${JSON.stringify(failures)}\nFix the code and reply with ` +
          `the whole script again. Change a test only when its expected result contradicts the job; never weaken a test (fewer ` +
          `records, a different expected value) just to make it pass.`
        : ""
    ]
      .filter(Boolean)
      .join("\n\n");
    let draft;
    try {
      draft = await model(prompt);
    } catch (error) {
      failures = [{ error: `the model's answer wasn't usable JSON: ${error.message}` }];
      await scripts.recordRound(appRow.id, key, round, { passed: 0, failed: 1, failures }, call);
      continue;
    }
    last = { summary: draft?.summary, code: draft?.code, tests: draft?.tests };
    const input = {
      key,
      kind,
      settings,
      summary: String(draft?.summary || ""),
      code: String(draft?.code || ""),
      tests: Array.isArray(draft?.tests) ? draft.tests : []
    };
    const checked = await scripts.test(input, call);
    const failed = checked.errors.length ? checked.errors : checked.results.filter((result) => !result.passed);
    await scripts.recordRound(appRow.id, key, round, {
      passed: checked.results.filter((result) => result.passed).length,
      failed: failed.length,
      failures: failed.slice(0, 10)
    }, call);
    if (!failed.length) {
      const saved = await scripts.save(actor, app, input, call);
      if (!saved.errors.length) {
        return {
          status: "saved",
          rounds: round,
          script: {
            key: saved.script.key,
            kind: saved.script.kind,
            summary: saved.script.summary,
            version: saved.script.version,
            tests: input.tests.length
          }
        };
      }
      failures = saved.errors;
      continue;
    }
    failures = failed.slice(0, 10);
  }
  return { status: "not saved", rounds, failures, last };
}
