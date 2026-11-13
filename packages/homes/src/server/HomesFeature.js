import { defineFeature } from "@jskit-ai/kernel/server/features";
import { firstHomeName } from "./firstHomeName.js";

// Homes (D-36), on JSKIT workspaces. JSKIT gives each person a first home and themes it; Mercbot
// names that first home, which WorkspacesFeature takes. Telling a home's people when its people
// change is HomeChangesFeature's, as it reads memberships.
const HomesFeature = defineFeature({
  id: "mercbot.homes",
  domain: "homes",
  provides: {
    personalWorkspaceName: "workspaces.personal-workspace-name"
  },
  async setup() {
    return {
      personalWorkspaceName: firstHomeName
    };
  }
});

export { HomesFeature };
