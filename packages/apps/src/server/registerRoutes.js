import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { homeOf } from "@local/homes/server/homeOf";
import { checkRouteVisibility } from "@jskit-ai/kernel/shared/support/visibility";
import { fieldByNames, isCalculated } from "../shared/calculated.js";
import { scopeStyle } from "./appStyle.js";
import { installTemplate, templateSummaries } from "./templates.js";
import { GateError } from "./validate.js";

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
        .map((field) => fieldByNames(table, field))
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
 */
export function registerRoutes(http, { appsRuntime, notices, streams }) {
  const { registry, gate, apps, practices, views, runtime, scripts, watches } = appsRuntime;
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
    handle(async (_request, ctx) => ({
      ...(await apps.list({}, ctx.options)),
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
      functions: await scripts.functionCode(app.id, ctx.options),
      style: scopeStyle(app.id, definition?.style),
      copyUpdates: await views.copyUpdates(definition, ctx.options),
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
    // Calculated fields' formulas as they were written, by names (D-78).
    const tables = (await registry.loadTables(ctx.options))
      .map((table) => ({ ...table, fields: table.fields.map((field) => fieldByNames(table, field)) }));
    if (request.query?.brief === "true") return { tables };
    const app = request.query?.app ? String(request.query.app) : null;
    const used = await apps.tablesUsed({ app }, ctx.options);
    const listed = app ? tables.filter((table) => used.has(table.id)) : tables;
    const counts = await Promise.all(listed.map((table) => (table.obsolete ? null : gate.count(ctx, table.id).catch(() => null))));
    return { tables: listed.map((table, index) => ({ ...table, count: counts[index], usedBy: used.get(table.id) || [] })) };
  }));
  /** The Data tab's spreadsheet: records of one table, through the data gate (via "data"). */
  const dataCtx = (ctx) => ({ ...ctx, via: { kind: "data" } });
  const records = `${data}/tables/:key/records`;
  const TEXTUAL = new Set(["text", "email", "phone", "choice"]);
  router.register("GET", records, home, handle(async (request, ctx) => {
    const { table } = await gate.tableFor(request.params.key, ctx.options);
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
        fields: table.fields.map((field) => fieldByNames(table, field))
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
    handle(async (_request, ctx) => ({ templates: templateSummaries(), canManage: ctx.canManage }))
  );
  router.register("POST", "/api/w/:workspaceSlug/apps-templates/:key/install", home, handle((request, ctx) => {
    if (!ctx.canManage) {
      throw forbidden("Only the home's owners and admins can install a template; or ask the Builder.", "apps_template_install_forbidden");
    }
    return installTemplate({ registry, apps, gate }, ctx, request.params.key, { sample: body(request).sample === true });
  }));

  // The home's look for its apps, and an app's own colour and density.
  router.register(
    "GET",
    "/api/w/:workspaceSlug/apps-theme",
    home,
    handle(async (_request, ctx) => ({ theme: await apps.homeTheme(ctx.options), canManage: ctx.canManage }))
  );
  router.register("PUT", "/api/w/:workspaceSlug/apps-theme", home, handle(async (request, ctx) => {
    if (!ctx.canManage) throw forbidden("Only the home's owners and admins can change how apps look.", "apps_style_manage_forbidden");
    return { theme: await apps.setHomeTheme(ctx.actor, body(request).theme, ctx.options) };
  }));
  router.register("PUT", `${base}/:slug/theme`, home, appRoute(async (request, ctx) => {
    if (!ctx.canManage) throw forbidden("Only the home's owners and admins can change how apps look.", "apps_style_manage_forbidden");
    return { theme: await apps.setAppTheme(ctx.actor, request.params.slug, body(request).theme, ctx.options) };
  }));

  // Scripts: an app's (the Logic tab) and the home's with the web addresses they may call.
  router.register(
    "GET",
    `${base}/:slug/scripts`,
    home,
    appRoute(async (request, ctx) => ({ ...(await scripts.list(request.params.slug, {}, ctx.options)), canManage: ctx.canManage }))
  );
  router.register("PUT", `${base}/:slug/scripts/:key/enabled`, home, appRoute((request, ctx) => {
    if (!ctx.canManage) throw forbidden("Only the home's owners and admins can switch scripts off or on.", "apps_script_switch_forbidden");
    return scripts.setEnabled(ctx.actor, request.params.slug, request.params.key, body(request).enabled === true, ctx.options);
  }));
  router.register(
    "GET",
    "/api/w/:workspaceSlug/apps-scripts",
    home,
    handle(async (_request, ctx) => ({
      scripts: await scripts.overview(ctx.options),
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
