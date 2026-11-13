import { calcTotal } from "./orders.js";
export function invoiceLine(customer, items) {
  return `${customer}: ${calcTotal(items).toFixed(2)}`;
}
