const config = require("../../config/payments");

async function createCheckout(invoice) {
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${config.stripe.secretKey}` },
    body: new URLSearchParams({ mode: "payment", "line_items[0][price_data][unit_amount]": String(invoice.total), client_reference_id: String(invoice.id) })
  });
  const session = await response.json();
  return { url: session.url };
}

function parseWebhook(body) {
  const event = JSON.parse(body);
  return event.type === "checkout.session.completed" ? { invoiceId: event.data.object.client_reference_id, amount: event.data.object.amount_total } : null;
}

module.exports = { createCheckout, parseWebhook };
