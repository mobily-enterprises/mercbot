// Settings from the environment, read once.
module.exports = {
  port: Number(process.env.PORT || 3000),
  databaseUrl: process.env.DATABASE_URL || "postgres://localhost/ledgerly",
  sessionDays: Number(process.env.SESSION_DAYS || 14),
  mailFrom: process.env.MAIL_FROM || "invoices@ledgerly.example",
  currency: process.env.CURRENCY || "AUD"
};
