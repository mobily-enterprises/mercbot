import { defineFeature } from "@jskit-ai/kernel/server/features";

// What JSKIT reports when a home's people or invitations change.
const HOME_ENTITIES = new Set(["member", "invite", "workspace"]);

// When a home's people change, everyone who is or was in it hears, through notices so every
// server does (D-15). Its own feature, apart from HomesFeature: it reads memberships, and
// WorkspacesFeature takes HomesFeature's first home's name.
const HomeChangesFeature = defineFeature({
  id: "mercbot.homes.changes",
  domain: "homes",
  requires: {
    events: "runtime.events",
    notices: "mercbot.notices",
    memberships: "workspaces.memberships"
  },
  /**
   * @param {object} capabilities
   * @param {import("@jskit-ai/kernel/server/types").RuntimeEvents} capabilities.events
   * @param {import("@local/notices/server/types").Notices} capabilities.notices
   * @param {import("@jskit-ai/workspaces-core/server/types").WorkspacesMemberships} capabilities.memberships
   */
  async setup({ events, notices, memberships }) {
    events.register({
      id: "mercbot.homes.changed",
      matches: (event) => event.type === "entity.changed" && event.source === "workspace" && HOME_ENTITIES.has(event.entity),
      async handle(event) {
        const homeId = event.entityId;
        // Everyone with a membership, whatever its status, including someone just removed, so their
        // page leaves. Memberships are deployment-wide (`public`), read here on no request.
        const people = (await memberships.listByWorkspaceId(homeId, {})).map((member) => member.userId).filter(Boolean);
        await notices.publishEach("bots", people, { type: "home-changed", homeId: String(homeId) })
          .catch((error) => console.warn("Telling people their home changed failed; they see it on their next read.", error));
      }
    });
    return {};
  }
});

export { HomeChangesFeature };
