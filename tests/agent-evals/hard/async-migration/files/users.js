const db = require("./db");

function createUser(name, email, callback) {
  if (!email.includes("@")) return callback(new Error("invalid email"));
  db.find("users", { email }, (error, existing) => {
    if (error) return callback(error);
    if (existing.length) return callback(new Error("email taken"));
    db.insert("users", { name, email }, callback);
  });
}

function getUser(id, callback) {
  db.find("users", { id }, (error, rows) => {
    if (error) return callback(error);
    if (!rows.length) return callback(new Error(`no user ${id}`));
    callback(null, rows[0]);
  });
}

module.exports = { createUser, getUser };
