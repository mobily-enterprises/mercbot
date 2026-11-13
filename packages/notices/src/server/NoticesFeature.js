// readable-check: allow no-direct-knex - infrastructure: the notices bus publishes and listens on the database connection itself (notices.js)
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createNotices } from "./notices.js";

const NoticesFeature = defineFeature({
  id: "mercbot.notices",
  domain: "notices",
  requires: {
    database: "runtime.database"
  },
  provides: {
    notices: "mercbot.notices"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/database-runtime/server/types").RuntimeDatabase} capabilities.database
   */
  async setup({ database }) {
    return { notices: createNotices({ knex: database.knex }) };
  },
  async shutdown(_dependencies, { outputs }) {
    await outputs.notices.close();
  }
});

export { NoticesFeature };
