import { computed, inject } from "vue";

/** The signed-in person's initials, which MercbotShell provides for group avatars. */
export const MERCBOT_INITIALS_KEY = "mercbotInitials";

// Where JSKIT serves the picture a person uploads in their account settings.
const UPLOADED_PICTURE_PATH = "/api/settings/profile/avatar";

/**
 * The picture the signed-in person uploaded, which the account button shows in place of their initials, or "" when
 * they have none. It is the address JSKIT's account bar shows, from the user in the placement context; for everyone
 * else JSKIT puts a Gravatar address there, which isn't a picture they gave Mercbot.
 * @param {{ avatarUrl?: string } | null | undefined} user
 * @returns {string}
 */
export function uploadedPicture(user) {
  const url = String(user?.avatarUrl || "");
  return url.startsWith(UPLOADED_PICTURE_PATH) ? url : "";
}

/**
 * The signed-in person's initials from the shell around the component; outside the shell there are
 * none to show.
 * @returns {import("vue").ComputedRef<string>}
 */
export function useShellInitials() {
  return inject(MERCBOT_INITIALS_KEY, computed(() => ""));
}
