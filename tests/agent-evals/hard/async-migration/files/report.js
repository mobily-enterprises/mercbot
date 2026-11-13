const { getUser } = require("./users");
const { ordersFor } = require("./orders");

// Spend per user, in the order of the ids given; a missing user fails the whole report.
function spendReport(userIds, callback) {
  const lines = [];
  let index = 0;
  function next() {
    if (index === userIds.length) return callback(null, lines);
    const id = userIds[index++];
    getUser(id, (error, user) => {
      if (error) return callback(error);
      ordersFor(id, (error2, orders) => {
        if (error2) return callback(error2);
        const spent = orders.reduce((sum, order) => sum + order.total, 0);
        lines.push(`${user.name}: ${spent.toFixed(2)}`);
        next();
      });
    });
  }
  next();
}

module.exports = { spendReport };
