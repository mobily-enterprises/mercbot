// A tiny in-memory store with callback-style access, as a stand-in for a real database driver.
const tables = { users: [], orders: [] };
let nextId = 1;

function insert(table, row, callback) {
  setTimeout(() => {
    if (!tables[table]) return callback(new Error(`no table ${table}`));
    const saved = { id: nextId++, ...row };
    tables[table].push(saved);
    callback(null, saved);
  }, 1);
}

function find(table, match, callback) {
  setTimeout(() => {
    if (!tables[table]) return callback(new Error(`no table ${table}`));
    callback(null, tables[table].filter((row) => Object.entries(match).every(([key, value]) => row[key] === value)));
  }, 1);
}

function reset(callback) {
  tables.users = []; tables.orders = []; nextId = 1;
  setTimeout(() => callback(null), 0);
}

module.exports = { insert, find, reset };
