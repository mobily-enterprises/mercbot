import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { homeOf } from "@local/homes/server/homeOf";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { fieldByNames, isCalculated } from "../shared/calculated.js";
import { scopeStyle } from "./appStyle.js";
import { templateSummaries } from "./templates.js";
import { CATALOG, needsOf } from "./tableCatalog.js";
import { GateError } from "./validate.js";
import { sendingOf } from "./appSending.js";

/**
 * A request's answer: the work's result, or the error it raised as a 4xx with its message, code
 * (such as "sign_in") and the values its sentence names; anything else is a server error. Other
 * features' routes about apps answer the same way.
 */
export async function answer(reply, work) {
  try {
    reply.code(200).send(await work());
  } catch (error) {
    if (!(Number.isInteger(error?.statusCode) && error.statusCode < 500)) throw error;
    reply.code(error.statusCode).send({ error: error.message, code: error.code, params: error.params });
  }
}

/**
 * A member's route in their home: `work(request, ctx)` gets the request's call options, the home, the person as the
 * audit's actor and whether they may manage the home's settings, and its answer is `answer`'s.
 */
export function handle(work) {
  return (request, reply) => answer(reply, async () => {
    const home = homeOf(request);
    const actor = {
      type: "person",
      id: String(home.userId),
      name: request.user?.displayName || request.user?.display_name || request.user?.username || "Someone"
    };
    // Owners and admins of the home choose its settings: the Builder, looks, scripts' switches and
    // web addresses, templates. Everyone in it uses every app and table (D-66).
    const canManage = hasPermission(request.permissions, "workspace.settings.update");
    // `options` are the request's call options: every handle call is in this home, as this person.
    return work(request, { options: await request.callOptions(), workspaceId: home.workspaceId, userId: home.userId, actor, canManage });
  });
}

const forbidden = (message, code) => new GateError(403, message, { code });

/** The tables as an app's screens need them: field names, labels, types and choices; never record data. */
const screenTables = (tables) =>
  tables
    .filter((table) => !table.obsolete)
    .map((table) => ({
      id: table.id,
      key: table.key,
      label: table.label,
      fields: table.fields
        .filter((field) => !field.obsolete)
        .map((field) => fieldByNames(table, field, tables))
        .map(({ key, label, type, options }) => ({ key, label, type, options }))
    }));

/**
 * The apps' routes (D-35, D-36). Every route is under the home's address; JSKIT checks membership,
 * and every app, table and record is looked up inside that home only.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {object} capabilities
 * @param {import("./types.js").Apps} capabilities.appsRuntime
 * @param {import("@local/notices/server/types").Notices} capabilities.notices
 * @param {Set<import("node:http").ServerResponse>} capabilities.streams the open live streams, closed on shutdown
 * @param {import("@jskit-ai/uploads-runtime/server/types").RuntimeUploads} capabilities.uploads a record's file, uploaded
 */
export function registerRoutes(http, { appsRuntime, notices, streams, uploads }) {
  const { registry, gate, apps, icons, practices, views, runtime, scripts, watches, homePeople, recordUploads, starterApps } = appsRuntime;
  const router = http.router;
  const home = Object.freeze({ auth: "required", contextPolicy: "required", visibility: checkRouteVisibility("workspace_user") });
  /** Routes for one app answer "not found" when the home has no such app. */
  const appRoute = (work) => handle(async (request, ctx) => {
    await apps.find(request.params.slug, ctx.options);
    return work(request, ctx);
  });
  const base = "/api/w/:workspaceSlug/apps";
  const body = (request) => request.body || {};

  router.register(
    "GET",
    base,
    home,
    // The home's list of apps is read as it opens (its sidebar): its starter apps come first, once (D-130).
    handle(async (_request, ctx) => ({
      ...(await starterApps.ensure(ctx.options).then(() => apps.list({}, ctx.options))),
      builder: await apps.builder(ctx.options),
      canManage: ctx.canManage
    }))
  );
  router.register(
    "GET",
    `${base}/builder`,
    home,
    handle(async (_request, ctx) => ({ builder: await apps.builder(ctx.options), canManage: ctx.canManage }))
  );
  // Ask Builder: the app's chat with the Builder, made the first time (D-41). Any member, as every app is everyone's.
  router.register("POST", `${base}/:slug/chat`, home, handle(async (request, ctx) => ({ chat: await apps.appChat(request.params.slug, ctx.options) })));
  // Which bot changes everyone's apps is the owners' and admins' choice (owner, 2026-10-31).
  router.register("PUT", `${base}/builder`, home, handle(async (request, ctx) => {
    if (!ctx.canManage) throw forbidden("Only the home's owners and admins can choose the Builder.", "apps_builder_manage_forbidden");
    return { builder: await apps.setBuilder(ctx.actor, body(request).botId, ctx.options) };
  }));
  router.register(
    "PUT",
    `${base}/pins`,
    home,
    handle((request, ctx) => apps.setPins(body(request).appIds, ctx.options).then((pins) => ({ pins })))
  );
  router.register("GET", `${base}/:slug`, home, appRoute(async (request, ctx) => {
    const { app, version, definition, tables } = await apps.get(request.params.slug, {
      version: request.query?.version === "draft" ? "draft" : "live"
    }, ctx.options);
    const theme = await apps.themeOf({ theme: app.themeOverride }, ctx.options);
    return {
      app,
      version,
      definition,
      tables: screenTables(tables),
      theme,
      functions: await scripts.functionCode(app.id, ctx.options, { draft: request.query?.version === "draft" }),
      style: scopeStyle(app.id, definition?.style),
      copyUpdates: await views.copyUpdates(definition, ctx.options),
      // Who is using it (`me` in its formulas) and the home's people, for person fields.
      me: { id: ctx.actor.id, name: ctx.actor.name },
      people: await homePeople(ctx.options),
      // The home's time zone, which "today" in its formulas is in (D-140).
      timeZone: await appsRuntime.homeZone.zoneOf(ctx.options),
      ...(app.kind === "view" ? await views.details(app, ctx.options) : {})
    };
  }));
  // A view as a part of an app's screen shows it (D-55): its screen, the tables it reads and its style, and
  // none of the rest GET /apps/:slug answers (bots' names, look, functions, copies).
  router.register("GET", `${base}/:slug/part`, home, handle(async (request, ctx) => {
    const { app, definition, tables } = await apps.get(request.params.slug, { botNames: false }, ctx.options);
    if (app.kind !== "view" || !definition?.screens?.main) {
      throw new GateError(404, `No view "${request.params.slug}".`, { code: "apps_view_not_found", params: { view: request.params.slug } });
    }
    return {
      app: { id: app.id, slug: app.slug },
      screen: definition.screens.main,
      tables: screenTables(tables),
      style: scopeStyle(app.id, definition.style)
    };
  }));
  router.register(
    "POST",
    `${base}/:slug/query`,
    home,
    appRoute((request, ctx) => runtime.query(ctx, { ...body(request), slug: request.params.slug }))
  );
  router.register(
    "POST",
    `${base}/:slug/action`,
    home,
    appRoute((request, ctx) => runtime.action(ctx, { ...body(request), slug: request.params.slug }))
  );
  // A card moved on a board, calendar or timeline: its record changes through the gate (D-140).
  router.register(
    "POST",
    `${base}/:slug/move`,
    home,
    appRoute((request, ctx) => runtime.move(ctx, { ...body(request), slug: request.params.slug }))
  );
  // The records a form's link field can be set to, through the gate (its first 100, or those whose title has `search`).
  router.register(
    "POST",
    `${base}/:slug/link-choices`,
    home,
    appRoute((request, ctx) => runtime.linkChoices(ctx, { ...body(request), slug: request.params.slug }))
  );
  // Reset: the draft preview's practice data starts again from the live records as they are now (D-71).
  router.register("POST", `${base}/:slug/practice/reset`, home, appRoute(async (request, ctx) => {
    const app = await apps.find(request.params.slug, ctx.options);
    if (!app.draftVersionId) throw new GateError(409, "There is no draft to practise with.", { code: "apps_draft_missing" });
    await practices.reset(app, String(app.draftVersionId), ctx.options);
    return { reset: true };
  }));
  // Publishing and restoring are people's actions: no bot tool calls these. On a public app, wider
  // visitor access needs an owner or admin (D-66).
  router.register(
    "POST",
    `${base}/:slug/publish`,
    home,
    appRoute((request, ctx) => apps.publish(ctx.actor, request.params.slug, { canManage: ctx.canManage }, ctx.options))
  );
  // A page of an app's versions, newest first; `before` (the last one shown) asks for the next.
  router.register(
    "GET",
    `${base}/:slug/versions`,
    home,
    appRoute((request, ctx) => apps.versions(request.params.slug, { before: request.query?.before || null }, ctx.options))
  );
  router.register("POST", `${base}/:slug/restore`, home, appRoute(async (request, ctx) => {
    const app = await apps.find(request.params.slug, ctx.options);
    return app.kind === "view"
      ? views.restore(ctx.actor, app.id, body(request).versionId, ctx.options)
      : apps.restore(ctx.actor, app.id, body(request).versionId, { canManage: ctx.canManage }, ctx.options);
  }));
  // Views (D-55): anyone in the home retires one and brings it back (D-62, D-66).
  router.register("POST", `${base}/:slug/retire`, home, appRoute((request, ctx) => views.retire(ctx, request.params.slug, ctx.options)));
  // Retired views aren't found by appRoute, so these look them up themselves.
  router.register("GET", `${base}/retired`, home, handle((_request, ctx) => views.retired(ctx.options).then((list) => ({ views: list }))));
  router.register("POST", `${base}/retired/:slug/bring-back`, home, handle((request, ctx) => views.bringBack(ctx, request.params.slug, ctx.options)));
  // An app's copy of a view takes the newer version, in the app's draft.
  router.register(
    "POST",
    `${base}/:slug/copies/:screen/update`,
    home,
    appRoute((request, ctx) => views.updateCopy(ctx.actor, request.params.slug, request.params.screen, ctx.options))
  );
  // Which of the home's tables changed, as server-sent events from any server, for open views.
  router.register("GET", "/api/w/:workspaceSlug/apps-events", home, (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    reply.raw.write(": connected\n\n");
    const unsubscribe = notices.subscribe("apps-data", homeOf(request).workspaceId, (event) => {
      reply.raw.write(`event: data\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const keepAlive = setInterval(() => reply.raw.write(": keep-alive\n\n"), 20000);
    streams.add(reply.raw);
    const stop = () => {
      clearInterval(keepAlive);
      unsubscribe();
      streams.delete(reply.raw);
    };
    // A page that went while the request was checked has already closed, so the stream stops at once.
    if (request.raw.destroyed) stop();
    else request.raw.on("close", stop);
  });

  // Tables of the home, with how many records they hold and which apps use them. `app` (an app's id)
  // keeps the tables that app uses and counts only those; `brief` answers the tables alone, without
  // counts or apps, for pickers and filters.
  const data = "/api/w/:workspaceSlug/app-data";
  router.register("GET", `${data}/tables`, home, handle(async (request, ctx) => {
    // Calculated fields' formulas as they were written, and roll-ups' settings, by names (D-78, D-140).
    const homeTables = await registry.loadTables(ctx.options);
    // Only the tables the person may read (D-138), each saying whether they may change it.
    const reachOf = async (table) => [await gate.canReach(ctx, table, "read"), await gate.canReach(ctx, table, "change")];
    const reach = await Promise.all(homeTables.map(reachOf));
    const tables = homeTables
      .map((table, index) => ({
        ...table,
        fields: table.fields.map((field) => fieldByNames(table, field, homeTables)),
        canChange: reach[index][1]
      }))
      .filter((_table, index) => reach[index][0]);
    // The home's people come with them, for person fields' pickers and names.
    if (request.query?.brief === "true") return { tables, people: await homePeople(ctx.options), canManage: ctx.canManage };
    const app = request.query?.app ? String(request.query.app) : null;
    const used = await apps.tablesUsed({ app }, ctx.options);
    const listed = app ? tables.filter((table) => used.has(table.id)) : tables;
    const counts = await Promise.all(listed.map((table) => (table.obsolete ? null : gate.count(ctx, table.id).catch(() => null))));
    return {
      tables: listed.map((table, index) => ({ ...table, count: counts[index], usedBy: used.get(table.id) || [] })),
      people: await homePeople(ctx.options)
    };
  }));
  // Who may read and change a table's records (D-138): its owners and admins choose, among the home's people.
  router.register("PUT", `${data}/tables/:key/access`, home, handle(async (request, ctx) => {
    if (!ctx.canManage) throw forbidden("Only the home's owners and admins can choose who sees a table.", "apps_table_access_forbidden");
    const input = body(request);
    const members = new Set((await homePeople(ctx.options)).map((person) => String(person.id)));
    if ((input.people || []).some((id) => !members.has(String(id)))) {
      throw new GateError(400, "Everyone named must be in the home.", { code: "apps_table_access_people_unknown" });
    }
    return { table: await registry.chooseAccess(ctx.actor, request.params.key, input, ctx.options) };
  }));
  /** The Data tab's spreadsheet: records of one table, through the data gate (via "data"). */
  const dataCtx = (ctx) => ({ ...ctx, via: { kind: "data" } });
  const records = `${data}/tables/:key/records`;
  const TEXTUAL = new Set(["text", "email", "phone", "choice", "longtext", "url"]);
  router.register("GET", records, home, handle(async (request, ctx) => {
    const { table, tables } = await gate.tableFor(request.params.key, ctx.options);
    const q = String(request.query?.search || "").trim().toLowerCase();
    // A calculated field (D-78) isn't stored, so the database can't look in it.
    const searchable = table.fields.filter((field) => !field.obsolete && TEXTUAL.has(field.type) && !isCalculated(field));
    // A search box looks in every text field, case-insensitively.
    const where =
      q && searchable.length
        ? {
            plan: {
              kind: "or",
              items: searchable.map((field) => ({
                kind: "like",
                mode: "contains",
                field: { name: field.id, lower: true },
                value: "state.q"
              }))
            },
            variables: { state: { q: "string" }, params: {} },
            values: { state: { q }, params: {} }
          }
        : null;
    const sortField = table.fields.find((field) => field.key === request.query?.sort || field.id === request.query?.sort);
    const result = await gate.read(ctx, table.id, {
      where,
      sort: sortField ? [{ field: sortField.id, desc: request.query?.desc === "true" }] : [],
      page: { size: Number(request.query?.size) || 50, number: Number(request.query?.page) || 1 },
      includeObsolete: request.query?.obsolete === "true"
    });
    return {
      table: {
        id: table.id,
        key: table.key,
        label: table.label,
        titleFieldId: table.titleFieldId,
        fields: table.fields.map((field) => fieldByNames(table, field, tables))
      },
      ...result
    };
  }));
  router.register("POST", records, home, handle((request, ctx) => gate.create(dataCtx(ctx), request.params.key, body(request).values)));
  router.register(
    "PATCH",
    `${records}/:id`,
    home,
    handle((request, ctx) => gate.update(dataCtx(ctx), request.params.key, request.params.id, body(request).values))
  );
  router.register(
    "POST",
    `${records}/:id/obsolete`,
    home,
    handle((request, ctx) => gate.markObsolete(dataCtx(ctx), request.params.key, request.params.id))
  );
  router.register(
    "POST",
    `${records}/:id/restore`,
    home,
    handle((request, ctx) => gate.restore(dataCtx(ctx), request.params.key, request.params.id))
  );
  // A spreadsheet import, in pages of up to 500 rows; `dryRun` only checks.
  router.register("POST", `${data}/tables/:key/import`, home, handle((request, ctx) => {
    const { rows, dryRun, firstRow, file } = body(request);
    return gate.importRecords({ ...ctx, via: { kind: "import", file: String(file || "").slice(0, 200) } }, request.params.key, rows, {
      dryRun: dryRun === true,
      firstRow: Number(firstRow) || 2
    });
  }));
  router.register(
    "GET",
    `${records}/:id/history`,
    home,
    handle(async (request, ctx) => ({ events: await gate.history(ctx, request.params.key, request.params.id) }))
  );
  // The records that link to one (D-130), by table and link field, the first page of each.
  router.register(
    "GET",
    `${records}/:id/related`,
    home,
    handle(async (request, ctx) => ({ groups: await gate.related(dataCtx(ctx), request.params.key, request.params.id) }))
  );
  /**
   * A record's file or picture, uploaded (D-130): read with the files' own size limit and picture and video check (D-90)
   * into a scratch folder, then written to the home's Database files and set on the record in one change by the gate.
   */
  router.register("POST", `${records}/:id/files/:field`, home, handle(async (request, ctx) => {
    const reader = recordUploads();
    if (!reader) throw new GateError(503, "Files can't be added right now.", { code: "apps_files_unavailable" });
    const part = await uploads.readSingleMultipartFile(request, { fieldName: "file", label: "File", maxBytes: reader.limit, required: true });
    const scratch = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mercbot-record-file-"));
    try {
      const source = path.join(scratch, "upload");
      await reader.receive(part.stream, {
        origin: "upload",
        workspaceId: ctx.workspaceId,
        userId: ctx.userId,
        botId: null,
        conversationId: null,
        place: null,
        path: null,
        ip: request.ip ?? null
      }, source);
      if (part.stream.truncated) {
        const limitMb = Math.floor(reader.limit / (1024 * 1024));
        throw new GateError(413, `That file is too big to add; the limit is ${limitMb} MB.`, { code: "apps_file_too_big", params: { limitMb } });
      }
      const record = await gate.attachFile(dataCtx(ctx), request.params.key, request.params.id, request.params.field, {
        source,
        name: part.fileName,
        type: part.mimeType
      });
      return { record };
    } finally {
      await fs.promises.rm(scratch, { recursive: true, force: true });
    }
  }));

  // Removing a field asks first (impact), then applies everywhere in one save, as the person.
  router.register("GET", `${data}/fields/:id/impact`, home, handle((request, ctx) => apps.fieldImpact(request.params.id, ctx.options)));
  router.register(
    "POST",
    `${data}/fields/:id/remove`,
    home,
    handle((request, ctx) => apps.removeField(ctx.actor, request.params.id, ctx.options))
  );

  router.register(
    "GET",
    "/api/w/:workspaceSlug/app-activity",
    home,
    handle(async (request, ctx) => ({
      events: await gate.activity(ctx, {
        table: request.query?.table,
        app: request.query?.app,
        actor: request.query?.actor,
        from: request.query?.from,
        to: request.query?.to,
        before: request.query?.before
      }),
      ...(request.query?.before ? {} : { actors: await gate.actors(ctx) })
    }))
  );

  // Ready-made apps: owners and admins install one as a draft (optionally with sample records).
  router.register(
    "GET",
    "/api/w/:workspaceSlug/apps-templates",
    home,
    handle(async (_request, ctx) => {
      // The shared tables (D-130), each with what it links to and whether this home has it yet.
      const have = new Set((await registry.loadTables(ctx.options)).filter((table) => !table.obsolete).map((table) => table.key));
      const sharedTables = [...CATALOG.values()].map((entry) => ({
        key: entry.key,
        label: entry.label,
        description: entry.description,
        linksTo: needsOf(entry).map((key) => CATALOG.get(key).label),
        ...(entry.extends ? { extends: CATALOG.get(entry.extends).label } : {}),
        inHome: have.has(entry.key)
      }));
      return { templates: templateSummaries(), sharedTables, canManage: ctx.canManage };
    })
  );
  router.register("POST", "/api/w/:workspaceSlug/apps-templates/:key/install", home, handle((request, ctx) => {
    if (!ctx.canManage) {
      throw forbidden("Only the home's owners and admins can install a template; or ask the Builder.", "apps_template_install_forbidden");
    }
    // The runtime's install, as the Builder's and the starter apps' are: it makes the shared tables a template uses (D-130).
    return appsRuntime.installTemplate(ctx, request.params.key, { sample: body(request).sample === true });
  }));

  // The home's look for its apps, and an app's own colour and density.
  router.register(
    "GET",
    "/api/w/:workspaceSlug/apps-theme",
    home,
    handle(async (_request, ctx) => ({
      theme: await apps.homeTheme(ctx.options),
      timeZone: await appsRuntime.homeZone.zoneOf(ctx.options),
      canManage: ctx.canManage
    }))
  );
  // The home's time zone for its apps (D-140): owners and admins choose, checked before anything else.
  router.register("PUT", "/api/w/:workspaceSlug/apps-time-zone", home, handle(async (request, ctx) => {
    if (!ctx.canManage) throw forbidden("Only the home's owners and admins can choose the apps' time zone.", "apps_time_zone_forbidden");
    return { timeZone: await appsRuntime.homeZone.chooseZone(ctx.actor, body(request).timeZone, ctx.options) };
  }));
  router.register("PUT", "/api/w/:workspaceSlug/apps-theme", home, handle(async (request, ctx) => {
    if (!ctx.canManage) throw forbidden("Only the home's owners and admins can change how apps look.", "apps_style_manage_forbidden");
    return { theme: await apps.setHomeTheme(ctx.actor, body(request).theme, ctx.options) };
  }));
  // An app's picture and colour (D-141): anyone in the home, as its screens are.
  router.register("PUT", `${base}/:slug/icon`, home, appRoute((request, ctx) => icons.set(ctx.actor, request.params.slug, body(request), ctx.options)));
  router.register("PUT", `${base}/:slug/theme`, home, appRoute(async (request, ctx) => {
    if (!ctx.canManage) throw forbidden("Only the home's owners and admins can change how apps look.", "apps_style_manage_forbidden");
    return { theme: await apps.setAppTheme(ctx.actor, request.params.slug, body(request).theme, ctx.options) };
  }));

  // Scripts: an app's (the Logic tab) and the home's with the web addresses they may call.
  router.register(
    "GET",
    `${base}/:slug/scripts`,
    home,
    appRoute(async (request, ctx) => ({
      ...(await scripts.list(request.params.slug, {}, ctx.options)),
      connected: await appsRuntime.connectedAccess.forApp(request.params.slug, ctx.options),
      canManage: ctx.canManage
    }))
  );
  // A button's change in a connected app, confirmed by the person it waited for (D-136): theirs alone, once.
  router.register("POST", `${base}/:slug/connected-confirm/:id`, home, handle(async (request, ctx) => {
    const app = await apps.find(request.params.slug, ctx.options);
    return scripts.confirmConnected(app.id, request.params.id, ctx.options);
  }));
  // The connected apps an app's scripts may use (D-136): owners and admins choose, checked before anything else.
  router.register("PUT", `${base}/:slug/connected-access`, home, appRoute(async (request, ctx) => {
    if (!ctx.canManage) {
      throw forbidden("Only the home's owners and admins can choose which connected apps scripts may use.", "apps_connected_manage_forbidden");
    }
    return { allowed: await appsRuntime.connectedAccess.allowConnected(ctx.actor, request.params.slug, body(request).apps, ctx.options) };
  }));
  // What an app's jobs and public forms may send without a button press (D-137): owners and admins switch it on, choose
  // the mailbox and the daily limit; the Logic tab reads it with the home's mailboxes and today's counts.
  router.register("GET", `${base}/:slug/sending`, home, appRoute(async (request, ctx) => {
    const app = await apps.find(request.params.slug, ctx.options);
    return {
      sending: sendingOf(app),
      today: await scripts.sending.today(app, ctx.options),
      mailboxes: ctx.canManage ? await appsRuntime.connectedMailboxes(ctx.options) : [],
      canManage: ctx.canManage
    };
  }));
  router.register("PUT", `${base}/:slug/sending`, home, appRoute(async (request, ctx) => {
    if (!ctx.canManage) throw forbidden("Only the home's owners and admins can choose what an app sends.", "apps_sending_manage_forbidden");
    const app = await apps.find(request.params.slug, ctx.options);
    apps.notAView(app, "send");
    return { sending: await scripts.sending.choose(ctx.actor, app, body(request), ctx.options) };
  }));
  router.register("PUT", `${base}/:slug/scripts/:key/enabled`, home, appRoute((request, ctx) => {
    if (!ctx.canManage) throw forbidden("Only the home's owners and admins can switch scripts off or on.", "apps_script_switch_forbidden");
    return scripts.setEnabled(ctx.actor, request.params.slug, request.params.key, body(request).enabled === true, ctx.options);
  }));
  router.register(
    "GET",
    "/api/w/:workspaceSlug/apps-scripts",
    home,
    handle(async (_request, ctx) => ({
      scripts: await scripts.overview({}, ctx.options),
      webAccess: await scripts.web.list(ctx.options),
      canManage: ctx.canManage
    }))
  );
  router.register("PUT", "/api/w/:workspaceSlug/apps-web-access", home, handle(async (request, ctx) => {
    if (!ctx.canManage) {
      throw forbidden("Only the home's owners and admins can choose which addresses scripts may call.", "apps_web_access_manage_forbidden");
    }
    return { webAccess: await scripts.web.set(ctx.actor, body(request).entries, ctx.options) };
  }));

  // Watches of the home's bots, for their Details panel: pause, resume or remove.
  router.register(
    "GET",
    `${base}/watches`,
    home,
    handle(async (request, ctx) => ({ watches: await watches.list({ botId: request.query?.bot || null }, ctx.options) }))
  );
  router.register(
    "PATCH",
    `${base}/watches/:id`,
    home,
    handle((request, ctx) => watches.setEnabled({ id: String(request.params.id) }, body(request).enabled === true, ctx.options))
  );
  router.register(
    "DELETE",
    `${base}/watches/:id`,
    home,
    handle((request, ctx) => watches.remove({ id: String(request.params.id) }, ctx.options))
  );
}
