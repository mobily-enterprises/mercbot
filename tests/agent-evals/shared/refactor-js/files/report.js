import { calcTotal } from "./orders.js";
export function bigOrders(orders, over) {
  return orders.filter((order) => calcTotal(order.items) > over).map((order) => order.id);
}
