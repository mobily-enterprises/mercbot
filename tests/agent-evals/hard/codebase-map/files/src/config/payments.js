// Payment providers: which ones are switched on, and each one's credentials.
module.exports = {
  enabledProviders: (process.env.PAYMENT_PROVIDERS || "stripe,paypal").split(","),
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET
  },
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID,
    clientSecret: process.env.PAYPAL_CLIENT_SECRET,
    webhookId: process.env.PAYPAL_WEBHOOK_ID
  }
};
