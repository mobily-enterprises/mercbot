import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { isPrivateAddress, publicLookup } from "@local/account/public-address";
import { seal, unseal, vaultKey } from "@local/account/vault-crypto";
import { checkAnswer } from "./answerCheck.js";
import { createFolderSite } from "./folderSite.js";
import { markerFile } from "./marker.js";
import { createS3Site } from "./s3Site.js";
import { WebsiteError } from "./websiteError.js";

// A home's own website (D-84): where its pages are uploaded (a folder a web server already serves, or S3-compatible
// storage) and the address that place is served at. Publishing a page puts a copy of what its link shows at
// <base URL>/<slug>/; publishing again replaces it, and unpublishing takes it away. Where it uploads, keys included,
// is sealed with the vault key and never shown again or logged, with whether it was saved by someone who runs the copy
// (`setUpByRunner`): anyone else's is a bucket and an address on the internet, reached and read back only at public
// internet addresses. The first publish to a new place is confirmed first, since it puts a page on the internet.

const WEBSITE_FIELDS = Object.freeze(["kind", "baseUrl", "settings", "confirmedAt"]);
const PUBLICATION_FIELDS = Object.freeze(["id", "botId", "path", "slug", "marker", "publishedAt"]);
// How many pages of one home may share a name before the next one is refused, for its own slug.
const SAME_NAMES = 50;

const invalid = (code, message) => new WebsiteError(400, message, { code });

/** The address a website serves its place at: http(s), without a query, ending in a slash. */
function baseUrlOf(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    url = null;
  }
  if (!url || !/^https?:$/u.test(url.protocol) || url.username || url.password) {
    throw invalid("websites_base_url_invalid", "Enter the address your website serves its pages at, starting with https:// or http://.");
  }
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

/** Where a website uploads, from what the person entered; the keys come from `previous` when left empty. */
function placeFrom(input, previous) {
  if (input.kind === "folder") {
    const folder = String(input.folder || "").trim().replace(/(.)\/+$/u, "$1");
    if (!path.isAbsolute(folder) || path.normalize(folder) !== folder) {
      throw invalid("websites_folder_invalid", "Enter the folder's whole path, starting with /.");
    }
    return { kind: "folder", folder };
  }
  if (input.kind !== "s3") throw invalid("websites_kind_unknown", "Choose a folder on this computer or S3-compatible storage.");
  const endpointText = String(input.endpoint || "").trim();
  let endpoint = "";
  if (endpointText) {
    let url = null;
    try {
      url = new URL(endpointText);
    } catch {
      url = null;
    }
    if (!url || !/^https?:$/u.test(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw invalid("websites_endpoint_invalid", "Enter the storage's endpoint, starting with https://, or leave it empty for Amazon S3.");
    }
    endpoint = url.href.replace(/\/+$/u, "");
  }
  const bucket = String(input.bucket || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u.test(bucket)) throw invalid("websites_bucket_invalid", "Enter the bucket's name.");
  const region = String(input.region || "").trim();
  if (!/^[A-Za-z0-9-]{0,40}$/u.test(region)) throw invalid("websites_region_invalid", "Enter the bucket's region, such as us-east-1.");
  const prefix = String(input.prefix || "").trim().replace(/^\/+|\/+$/gu, "");
  if (prefix && prefix.split("/").some((part) => !part || part === "." || part === "..")) {
    throw invalid("websites_prefix_invalid", "Enter the folder in the bucket as names separated by /, or leave it empty.");
  }
  // Leaving the keys empty keeps the saved ones for the same storage.
  const kept = previous?.kind === "s3" && previous.endpoint === endpoint ? previous : null;
  const accessKeyId = String(input.accessKeyId || "").trim() || kept?.accessKeyId || "";
  const secretAccessKey = String(input.secretAccessKey || "") || kept?.secretAccessKey || "";
  if (!accessKeyId || !secretAccessKey) throw invalid("websites_keys_missing", "Enter the access key and its secret.");
  return { kind: "s3", endpoint, region, bucket, prefix, accessKeyId, secretAccessKey };
}

/** Whether two places upload to the same folder or bucket folder. */
const samePlace = (a, b) =>
  a.kind === b.kind && (a.kind === "folder" ? a.folder === b.folder : a.endpoint === b.endpoint && a.bucket === b.bucket && a.prefix === b.prefix);

/** A page's slug on a website, from its file's name: lowercase letters, digits and dashes. */
function slugOf(pagePath) {
  const name = path.posix.basename(String(pagePath), ".html").normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase();
  return name.replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 60) || "page";
}

const urlOf = (baseUrl, slug) => new URL(`${slug}/`, baseUrl).href;

/**
 * Whether an address is on a private network: written as such an address, or a name leading to one (publicLookup). A
 * name that doesn't resolve isn't, and its read-back says so later.
 */
async function onPrivateNetwork(address) {
  const host = new URL(address).hostname.replace(/^\[|\]$/gu, "");
  if (isIP(host)) return isPrivateAddress(host);
  return new Promise((resolve) => {
    publicLookup()(host, { all: true }, (error) => resolve(error?.code === "PRIVATE_ADDRESS"));
  });
}

/**
 * @param {object} dependencies
 * @param {{ homeWebsites: object, pagePublications: object }} dependencies.resources this feature's handles
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {{ published: Function }} dependencies.pages files.pages: a page's copy for a website
 * @param {(options: object) => Promise<boolean>} dependencies.runsThisCopy whether the call's person runs this copy (D-59; a
 *   person's own copy's one person, D-81)
 * @param {typeof checkAnswer} [dependencies.check] reading a page back at its address
 */
export function createWebsites({ resources, systemContext, env, pages, runsThisCopy, check = checkAnswer }) {
  const { homeWebsites, pagePublications } = resources;
  /** The options of following a page's moves, which run after the files' own route already allowed them. */
  const inHome = (homeId) => ({ context: systemContext("follow a published page as it moves or goes in its home's files").forWorkspace(String(homeId)) });

  function keyOf() {
    const key = vaultKey(env);
    if (!key) {
      throw new WebsiteError(503, "This server can't keep a website's keys safe: it has no vault key.", { code: "websites_vault_key_missing" });
    }
    return key;
  }

  async function websiteOf(options) {
    const [found] = await homeWebsites.queryAll({ fields: WEBSITE_FIELDS }, passedOn(options));
    return found ?? null;
  }
  const placeOf = (found) => ({ kind: found.kind, ...unseal(found.settings, keyOf()) });
  // Storage set up by someone who doesn't run the copy is reached only at public internet addresses.
  const siteOf = (place) => (place.kind === "folder" ? createFolderSite(place.folder) : createS3Site({ ...place, guarded: place.setUpByRunner !== true }));

  async function publicationOf({ botId, path: pagePath }, options) {
    const filters = { botId: String(botId), path: pagePath };
    const [found] = await pagePublications.queryAll({ filters, fields: PUBLICATION_FIELDS }, passedOn(options));
    return found ?? null;
  }
  async function anyPublished(options) {
    return (await pagePublications.query({ fields: ["slug"], page: { size: 1 } }, passedOn(options))).records.length > 0;
  }

  /** The home's website as Settings shows it: never its keys. */
  async function describe(options) {
    const found = await websiteOf(options);
    if (!found) return { website: null };
    const place = placeOf(found);
    const shown = place.kind === "folder"
      ? { folder: place.folder }
      : { endpoint: place.endpoint, region: place.region, bucket: place.bucket, prefix: place.prefix, hasKeys: true };
    const hasPages = await anyPublished(options);
    return { website: { kind: place.kind, baseUrl: found.baseUrl, ...shown, confirmed: Boolean(found.confirmedAt), hasPages } };
  }

  /**
   * Sets the home's website up, or changes it: the place is checked (the folder is there and writable, or the bucket
   * answers to the keys) before anything is saved. Its place doesn't change while pages are on it, and a new place or
   * address is confirmed again at its first publish.
   */
  async function save(input, options) {
    // Mercbot writes in a folder on this computer with the server's own rights, so only the people who run this copy
    // choose one; anyone else's website is in storage of their own, and on the internet.
    const setUpByRunner = await runsThisCopy(options);
    if (input?.kind === "folder" && !setUpByRunner) {
      throw new WebsiteError(403, "Only the people who run this copy of Mercbot can publish to a folder on its computer. Choose S3-compatible storage.", {
        code: "websites_folder_forbidden"
      });
    }
    const key = keyOf();
    const found = await websiteOf(options);
    const previous = found ? placeOf(found) : null;
    const baseUrl = baseUrlOf(input.baseUrl);
    const place = { ...placeFrom(input || {}, previous), setUpByRunner };
    if (!setUpByRunner && (await onPrivateNetwork(baseUrl))) {
      const host = new URL(baseUrl).host;
      throw new WebsiteError(403, `${host} is on a private network. Only the people who run this copy of Mercbot can give the website an address there: enter the address it's served at on the internet, or ask them to set the website up.`, {
        code: "websites_address_private", params: { host }
      });
    }
    if (previous && !samePlace(previous, place) && (await anyPublished(options))) {
      throw new WebsiteError(409, "Pages are published on this website. Unpublish them before changing where it uploads.", { code: "websites_pages_published" });
    }
    await siteOf(place).check();
    const { kind, ...settings } = place;
    const stillConfirmed = previous && samePlace(previous, place) && found.baseUrl === baseUrl && found.confirmedAt;
    const confirmedAt = stillConfirmed ? new Date(found.confirmedAt).toISOString() : null;
    await homeWebsites.createMany([{ kind, baseUrl, settings: seal(settings, key), confirmedAt }], {
      ...passedOn(options), onConflict: { keys: ["workspaceId"], action: "merge" }, returning: "none"
    });
    return describe(options);
  }

  /** Forgets the home's website: only once no page is published on it, so none is left that Mercbot can't take back. */
  async function remove(homeId, options) {
    if (await anyPublished(options)) {
      throw new WebsiteError(409, "Pages are published on this website. Unpublish them first.", { code: "websites_pages_published" });
    }
    await homeWebsites.deleteWhere({ workspaceId: String(homeId) }, { ...passedOn(options), returning: "none" });
    return { website: null };
  }

  /** A page's place on the website: where it's published, and whether its first publish there is confirmed first. */
  async function state(page, options) {
    const found = await websiteOf(options);
    const publication = found ? await publicationOf(page, options) : null;
    return {
      website: found ? { baseUrl: found.baseUrl } : null,
      publication: publication?.publishedAt
        ? { url: urlOf(found.baseUrl, publication.slug), publishedAt: new Date(publication.publishedAt).toISOString() }
        : null,
      confirmFirst: !found?.confirmedAt
    };
  }

  /**
   * The page's publication, or a new one with a slug no other page of the home has (its name, then its name with -2,
   * -3…), reserved before anything is uploaded. Two first publishes of one page at once share one.
   */
  function reserve(page, options) {
    return retryLostInsertRace(options, async () => {
      const existing = await publicationOf(page, options);
      if (existing) return existing;
      const slug = slugOf(page.path);
      for (let n = 1; n <= SAME_NAMES; n += 1) {
        const row = {
          botId: String(page.botId),
          path: page.path,
          slug: n === 1 ? slug : `${slug}-${n}`,
          marker: randomBytes(12).toString("base64url"),
          publishedAt: null
        };
        const [created] = await pagePublications.createMany([row], {
          ...passedOn(options), onConflict: { keys: ["workspaceId", "slug"], action: "ignore" }, returning: "records"
        });
        if (created) return { ...row, id: created.id };
      }
      throw new WebsiteError(409, `${SAME_NAMES} pages with this name are published already. Rename this one first.`, { code: "websites_slug_exhausted" });
    });
  }

  /** Takes the publication's copy off the site, when it's still the one Mercbot put there. */
  async function takeDown(site, publication) {
    const there = await site.read(publication.slug);
    if (there.exists && there.marker === publication.marker) await site.remove(publication.slug);
  }

  /**
   * Publishes the page to the home's website, or publishes it again: its copy replaces whatever this page had there.
   * Anything else already at its address stays and the publish is refused. Then its address is read back.
   */
  async function publish({ confirmed, ...page }, options) {
    const found = await websiteOf(options);
    if (!found) throw new WebsiteError(409, "Set up your website first, in Settings → Website.", { code: "websites_not_set_up" });
    if (!found.confirmedAt && !confirmed) {
      throw new WebsiteError(409, "Publishing puts this page on the internet, for anyone. Confirm to go on.", { code: "websites_confirm_first" });
    }
    const place = placeOf(found);
    const site = siteOf(place);
    const stamp = randomBytes(18).toString("base64url");
    const copy = await pages.published(page, { stamp });
    const publication = await reserve(page, options);
    const url = urlOf(found.baseUrl, publication.slug);
    try {
      const there = await site.read(publication.slug);
      if (there.exists && there.marker !== publication.marker) {
        throw new WebsiteError(409, `Something Mercbot didn't put there is at ${url} already. Move it away, or rename the page.`, { code: "websites_place_taken", params: { url } });
      }
      const index = { path: "index.html", type: "text/html; charset=utf-8", content: Buffer.from(copy.html, "utf8") };
      await site.put(publication.slug, [markerFile(publication.marker), ...copy.files, index]);
    } catch (error) {
      // A page never published forgets the slug it had reserved.
      if (!publication.publishedAt) await pagePublications.deleteWhere({ id: String(publication.id) }, { ...passedOn(options), returning: "none" });
      throw error;
    }
    const publishedAt = new Date().toISOString();
    await pagePublications.patchWhere({ id: String(publication.id) }, { publishedAt }, { ...passedOn(options), returning: "none" });
    if (!found.confirmedAt) {
      await homeWebsites.patchWhere({ workspaceId: String(page.homeId) }, { confirmedAt: publishedAt }, { ...passedOn(options), returning: "none" });
    }
    return {
      website: { baseUrl: found.baseUrl },
      publication: { url, publishedAt },
      confirmFirst: false,
      // A website set up by someone who doesn't run the copy is read back at public internet addresses only.
      check: await check(url, stamp, { guarded: place.setUpByRunner !== true })
    };
  }

  /** Takes the page off the home's website; one that isn't there is already off. */
  async function unpublish(page, options) {
    const publication = await publicationOf(page, options);
    const found = publication && (await websiteOf(options));
    if (found) await takeDown(siteOf(placeOf(found)), publication);
    if (publication) await pagePublications.deleteWhere({ botId: String(page.botId), path: page.path }, { ...passedOn(options), returning: "none" });
    return state(page, options);
  }

  /**
   * Follows a page as it moves or goes in its home's files (files.pages.follow): its publication moves with it and
   * keeps its address, or its copy is taken off the website and the publication goes. A copy that can't be taken off
   * now stays on the website.
   */
  async function pageChanged({ homeId, botId, from, to }) {
    const options = inHome(homeId);
    const where = botId ? { botId, path: from } : { path: from };
    if (to) {
      await pagePublications.patchWhere(where, { path: to }, { ...passedOn(options), returning: "none" });
      return;
    }
    const publications = await pagePublications.queryAll({ filters: where, fields: PUBLICATION_FIELDS }, passedOn(options));
    if (!publications.length) return;
    const found = await websiteOf(options);
    for (const publication of publications) {
      if (found) {
        await takeDown(siteOf(placeOf(found)), publication).catch((error) =>
          console.warn("Taking a deleted page off its home's website failed; its copy stays there.", error?.message));
      }
      await pagePublications.deleteWhere({ id: String(publication.id) }, { ...passedOn(options), returning: "none" });
    }
  }

  return Object.freeze({
    describe,
    save,
    remove,
    state,
    publish,
    unpublish,
    pageChanged
  });
}

/** Pure helpers the tests reach directly (rule 64). */
export const __testables = Object.freeze({ baseUrlOf, placeFrom, slugOf });
