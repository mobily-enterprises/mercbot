const db = require("./db");
const { getUser } = require("./users");

function placeOrder(userId, items, callback) {
  getUser(userId, (error, user) => {
    if (error) return callback(error);
    if (!items.length) return callback(new Error("empty order"));
    const total = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    db.insert("orders", { userId: user.id, items, total }, callback);
  });
}

function ordersFor(userId, callback) {
  db.find("orders", { userId }, callback);
}

module.exports = { placeOrder, ordersFor };
