// Who may do what in a home (D-36). A home is a JSKIT workspace; these are its roles. The owner
// created the home and can't be assigned or removed; admins manage people, invitations and the
// home's rules; members use the home's bots.
export const roleCatalog = {
  workspace: {
    defaultInviteRole: "member"
  },
  roles: {
    owner: {
      label: "Owner",
      assignable: false,
      permissions: ["*"]
    },
    admin: {
      label: "Admin",
      assignable: true,
      inherits: "member",
      permissions: [
        "workspace.roles.view",
        "workspace.settings.update",
        "workspace.members.view",
        "workspace.members.invite",
        "workspace.members.manage",
        "workspace.invites.revoke"
      ]
    },
    member: {
      label: "Member",
      assignable: true,
      permissions: ["workspace.settings.view", "workspace.members.view"]
    }
  }
};
