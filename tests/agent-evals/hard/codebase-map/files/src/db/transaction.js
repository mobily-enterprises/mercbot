const { pool } = require("./pool");

// Runs `work(client)` in one transaction: committed if it finishes, rolled back if it throws.
async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction };
