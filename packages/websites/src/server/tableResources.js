// The tables as JSKIT table resources, one per table, as the migration makes them (D-84).
import { defineTableResource } from "@jskit-ai/resource-core/shared/tableResource";

/** home_websites: a home's own website; where it uploads is sealed in `settings` */
export const homeWebsiteResource = defineTableResource({
  name: "homeWebsites",
  tableName: "home_websites",
  ownership: "workspace",
  schema: {
    baseUrl: { type: "string", noTrim: true, required: true },
    confirmedAt: { type: "dateTime", nullable: true },
    kind: { type: "string", maxLength: 12, noTrim: true, required: true },
    settings: { type: "object", required: true, additionalProperties: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});

/** page_publications: a page published to the home's website */
export const pagePublicationResource = defineTableResource({
  name: "pagePublications",
  tableName: "page_publications",
  ownership: "workspace",
  schema: {
    botId: { type: "id", required: true, search: true },
    marker: { type: "string", maxLength: 32, noTrim: true, required: true },
    path: { type: "string", noTrim: true, required: true, search: true },
    publishedAt: { type: "dateTime", nullable: true },
    slug: { type: "string", maxLength: 80, noTrim: true, required: true, search: true },
    workspaceId: { type: "id", hidden: true, search: true }
  }
});
