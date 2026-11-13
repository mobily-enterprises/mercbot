const placements = [];

function addPlacementTopology(value = {}) {
  placements.push(value);
}

export { addPlacementTopology };
export default { placements };

const menuLinkRenderers = Object.freeze({
  link: "local.main.ui.surface-aware-menu-link-item"
});

const bottomNavLinkRenderers = Object.freeze({
  link: "local.main.ui.tab-link-item"
});

addPlacementTopology({
  id: "shell.primary-nav",
  description: "Primary top-level navigation for the current surface.",
  surfaces: ["*"],
  default: true,
  variants: {
    compact: {
      outlet: "shell-layout:primary-bottom-nav",
      renderers: bottomNavLinkRenderers
    },
    medium: {
      outlet: "shell-layout:primary-menu",
      renderers: menuLinkRenderers
    },
    expanded: {
      outlet: "shell-layout:primary-menu",
      renderers: menuLinkRenderers
    }
  }
});

addPlacementTopology({
  id: "shell.secondary-nav",
  description: "Secondary navigation for the current surface.",
  surfaces: ["*"],
  variants: {
    compact: {
      outlet: "shell-layout:secondary-menu",
      renderers: menuLinkRenderers
    },
    medium: {
      outlet: "shell-layout:secondary-menu",
      renderers: menuLinkRenderers
    },
    expanded: {
      outlet: "shell-layout:secondary-menu",
      renderers: menuLinkRenderers
    }
  }
});

addPlacementTopology({
  id: "shell.identity",
  description: "Current surface identity controls.",
  surfaces: ["*"],
  variants: {
    compact: { outlet: "shell-layout:top-left" },
    medium: { outlet: "shell-layout:top-left" },
    expanded: { outlet: "shell-layout:top-left" }
  }
});

addPlacementTopology({
  id: "shell.status",
  description: "Current account and utility controls.",
  surfaces: ["*"],
  variants: {
    compact: { outlet: "shell-layout:top-right" },
    medium: { outlet: "shell-layout:top-right" },
    expanded: { outlet: "shell-layout:top-right" }
  }
});

addPlacementTopology({
  id: "shell.global-actions",
  description: "Global actions outside primary navigation.",
  surfaces: ["*"],
  variants: {
    compact: {
      outlet: "shell-layout:top-right",
      renderers: menuLinkRenderers
    },
    medium: {
      outlet: "shell-layout:top-right",
      renderers: menuLinkRenderers
    },
    expanded: {
      outlet: "shell-layout:top-right",
      renderers: menuLinkRenderers
    }
  }
});

addPlacementTopology({
  id: "page.supporting-content",
  description: "Responsive supporting page content.",
  surfaces: ["*"],
  variants: {
    compact: { outlet: "shell-layout:supporting-bottom-sheet" },
    medium: { outlet: "shell-layout:supporting-side-panel" },
    expanded: { outlet: "shell-layout:supporting-side-panel" }
  }
});

addPlacementTopology({
  id: "auth.profile-menu",
  description: "Authenticated profile menu actions.",
  surfaces: ["*"],
  variants: {
    compact: {
      outlet: "auth-profile-menu:primary-menu",
      renderers: { link: "auth.web.profile.menu.link-item" }
    },
    medium: {
      outlet: "auth-profile-menu:primary-menu",
      renderers: { link: "auth.web.profile.menu.link-item" }
    },
    expanded: {
      outlet: "auth-profile-menu:primary-menu",
      renderers: { link: "auth.web.profile.menu.link-item" }
    }
  }
});

addPlacementTopology({
  id: "settings.sections",
  owner: "account-settings",
  description: "Self-service account settings sections.",
  surfaces: ["account"],
  variants: {
    compact: { outlet: "account-settings:sections" },
    medium: { outlet: "account-settings:sections" },
    expanded: { outlet: "account-settings:sections" }
  }
});
