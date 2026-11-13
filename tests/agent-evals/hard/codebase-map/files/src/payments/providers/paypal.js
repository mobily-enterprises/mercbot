const config = require("../../config/payments");

async function createCheckout(invoice) {
  const token = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString("base64");
  const response = await fetch("https://api-m.paypal.com/v2/checkout/orders", {
    method: "POST",
    headers: { authorization: `Basic ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ reference_id: String(invoice.id), amount: { value: (invoice.total / 100).toFixed(2) } }] })
  });
  const order = await response.json();
  return { url: order.links.find((link) => link.rel === "approve").href };
}

function parseWebhook(body) {
  const event = JSON.parse(body);
  return event.event_type === "PAYMENT.CAPTURE.COMPLETED" ? { invoiceId: event.resource.custom_id, amount: Math.round(Number(event.resource.amount.value) * 100) } : null;
}

module.exports = { createCheckout, parseWebhook };
