import { ref } from "vue";
import { appsApi } from "@/components/apps/appsApi.js";

// Which bot is the current home's Builder (D-35), for its own resting face: it builds apps by
// thinking things through, so it looks like it (MercbotAvatar). Loaded with the shell and updated
// when someone makes another bot the Builder.
// readable-check: allow module-state - shared resource: every avatar on the page reads which bot is the home's one Builder
export const builderBotId = ref(null);

export async function loadBuilderBot() {
  builderBotId.value = (await appsApi.builder().catch(() => ({ builder: null }))).builder?.id ?? null;
}
