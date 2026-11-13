import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { defineFeature } from "@jskit-ai/kernel/server/features";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { homeWebsiteResource, pagePublicationResource } from "./tableResources.js";
import { registerWebsiteRoutes } from "./websiteRoutes.js";
import { createWebsites } from "./websites.js";

/** The tables the websites feature owns. */
export const WEBSITES_OWNS = Object.freeze([homeWebsiteResource, pagePublicationResource]);

// A home's own website (D-84): a folder a web server already serves, or S3-compatible storage, and the address it is
// served at; the pages people publish there follow their files as they move or go. The whole feature is this package,
// so a server composed without it has no website, its routes or its tables.
const WebsitesFeature = defineFeature({
  id: "mercbot.websites",
  domain: "websites",
  owns: WEBSITES_OWNS,
  systemScope:
    "follow a page published to its home's website as it moves or goes in the home's files, which runs after the files' own route allowed it: its publication moves with it, or its copy is taken off the website",
  requires: {
    records: "mercbot.bots.records",
    account: "mercbot.account",
    http: "runtime.http",
    env: "runtime.env",
    files: "mercbot.files"
  },
  /**
   * @param {object} capabilities
   * @param {{ directory: object }} capabilities.records mercbot.bots.records
   * @param {import("@local/account/server/types").Account} capabilities.account mercbot.account: who runs this copy
   * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} capabilities.http
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} capabilities.env
   * @param {import("@local/files/server/types").Files} capabilities.files mercbot.files: its pages
   * @param {Record<string, any>} capabilities.resources this feature's handles
   * @param {(reason: string) => object} capabilities.systemContext
   */
  setup({ records, account, http, env, files, resources, systemContext }) {
    const runsThisCopy = (options) => account.runsThisCopy(resolveAuditActorId(options?.context), passedOn(options));
    const websites = createWebsites({ resources, systemContext, env, pages: files.pages, runsThisCopy });
    files.pages.follow(websites.pageChanged);
    registerWebsiteRoutes(http, { websites, pages: files.pages, directory: records.directory, runsThisCopy });
    return {};
  }
});

export { WebsitesFeature };
