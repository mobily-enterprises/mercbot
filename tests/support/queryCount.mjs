// Counting a piece of work's SQL, for the cases that check a cost doesn't grow with the rows.

// AnyAPI checks its schema versions every few seconds whatever the work; those reads aren't the work's.
const SCHEMA_CHECK = /any_(resource|field|relationship)_configs/u;

/**
 * How many SQL statements `work` sends through `knex`, transactions included, apart from AnyAPI's
 * schema checks; with `matching`, only the statements whose SQL it matches.
 * @param {import("knex").Knex} knex
 * @param {() => Promise<unknown>} work
 * @param {{ matching?: RegExp }} [options]
 */
export async function queriesDuring(knex, work, { matching = null } = {}) {
  let count = 0;
  const counted = (query) => {
    const sql = String(query?.sql || "");
    if (!SCHEMA_CHECK.test(sql) && (!matching || matching.test(sql))) count += 1;
  };
  knex.on("query", counted);
  try {
    await work();
  } finally {
    knex.removeListener("query", counted);
  }
  return count;
}

/**
 * The SQL statements `work` sends whose SQL `matching` matches, apart from AnyAPI's schema checks, as
 * { sql, bindings }, to look at their plans (planOf) when one statement's cost, not the number of
 * statements, is the question.
 * @param {import("knex").Knex} knex
 * @param {() => Promise<unknown>} work
 * @param {RegExp} matching
 */
export async function statementsDuring(knex, work, matching) {
  const statements = [];
  const seen = (query) => {
    const sql = String(query?.sql || "");
    if (!SCHEMA_CHECK.test(sql) && matching.test(sql)) statements.push({ sql, bindings: query.bindings || [] });
  };
  knex.on("query", seen);
  try {
    await work();
  } finally {
    knex.removeListener("query", seen);
  }
  return statements;
}

/**
 * For work that is one query whose cost hides in how much it reads: the plans (planOf) of the reads
 * (select or with) that `work` sends.
 * @param {import("knex").Knex} knex
 * @param {() => Promise<unknown>} work
 */
export async function plansDuring(knex, work) {
  const plans = [];
  for (const statement of await statementsDuring(knex, work, /^\s*(select|with)\b/iu)) plans.push(await planOf(knex, statement));
  return plans;
}

/**
 * How PostgreSQL runs one statement: it runs again under EXPLAIN (ANALYZE, FORMAT JSON) in a
 * transaction that is then rolled back, so a write leaves nothing behind, with sequential scans off,
 * so a small test table is read through an index whenever one fits, as a large one would be. The
 * answer is { sql, plan, rowsRead, indexes }: `rowsRead` sums, over the nodes that read a table or an
 * index, the rows they returned and the rows their filters removed, times their loops (index and heap
 * of a bitmap scan both count); `indexes` names the indexes used.
 * @param {import("knex").Knex} knex
 * @param {{ sql: string, bindings: unknown[] }} statement
 */
export async function planOf(knex, { sql, bindings }) {
  // Knex reports PostgreSQL's numbered placeholders ($1); its raw() takes "?", and a backslash before a literal one.
  const values = [];
  const text = sql.replace(/\?/gu, "\\?").replace(/\$(\d+)/gu, (_, number) => (values.push(bindings[Number(number) - 1]), "?"));
  const transaction = await knex.transaction();
  let plan = null;
  try {
    await transaction.raw("set local enable_seqscan = off");
    plan = (await transaction.raw(`explain (analyze, format json) ${text}`, values)).rows[0]["QUERY PLAN"][0].Plan;
  } finally {
    await transaction.rollback();
  }
  const indexes = new Set();
  const read = (node) => {
    if (node["Index Name"]) indexes.add(node["Index Name"]);
    const own = node["Relation Name"] || node["Index Name"]
      ? ((node["Actual Rows"] || 0) + (node["Rows Removed by Filter"] || 0) + (node["Rows Removed by Index Recheck"] || 0)) * (node["Actual Loops"] || 1)
      : 0;
    return own + (node.Plans || []).reduce((sum, child) => sum + read(child), 0);
  };
  return { sql, plan, rowsRead: read(plan), indexes };
}
