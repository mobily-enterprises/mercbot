<script setup>
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { appsApi, errorText } from "@/components/apps/appsApi.js";
import { PAPER } from "@/theme/palettes.js";
import { fileUrl, isHtmlPage, pageCopyUrl } from "./filesApi.js";
import { doorwayLocation } from "./pageMessages.js";
import MercbotIconButton from "./MercbotIconButton.vue";
import MercbotMarkdownPage from "./MercbotMarkdownPage.vue";
import MercbotPageFrame from "./MercbotPageFrame.vue";
import MercbotPageShare from "./MercbotPageShare.vue";
import MercbotPageVersions from "./MercbotPageVersions.vue";

// A page open in place of the chat (D-74): close, its title, Share and a menu with Versions
// and a copy to download, over the page itself; the composer stays at the bottom, still sending to
// the bot, and closing goes back to the same place in the chat. `stamp` changes when the bot saves
// the page again, which shows the new version. An old Markdown page shows as it always did.
const props = defineProps({
  botId: { type: String, required: true },
  path: { type: String, required: true },
  title: { type: String, required: true },
  // An old Markdown page a bot made in a group with several people is in its folder for the group (D-46).
  group: { type: String, default: null },
  stamp: { type: String, default: "" },
  botName: { type: String, default: "The bot" },
  me: { type: String, default: "" },
  // Room at the bottom for the composer floating over the page.
  bottom: { type: Number, default: 0 }
});
const emit = defineEmits(["close", "toast", "failure"]);

const router = useRouter();
const paths = usePaths();
const html = computed(() => isHtmlPage(props.path));
const frame = ref(null);
const shareOpen = ref(false);
const versionsOpen = ref(false);
const copyUrl = computed(() => (html.value ? pageCopyUrl(props.botId, props.path) : fileUrl(props.botId, props.path, { group: props.group })));

watch(() => props.stamp, () => frame.value?.reload());

// The doorway (D-40): the app opens in its own view, only if it's one of this home's that the person
// may open; nothing comes back into the page.
async function openApp(door) {
  try {
    const answer = await doorwayLocation(door, {
      listApps: () => appsApi.list(),
      getApp: (slug) => appsApi.get(slug),
      appAddress: (slug) => paths.page(`/apps/${slug}`)
    });
    if (answer.problem) emit("toast", answer.problem);
    else await router.push(answer.location);
  } catch (error) {
    emit("toast", errorText(error, "That app couldn't open."));
  }
}

function restored() {
  frame.value?.reload();
  emit("toast", "Version restored");
}
</script>

<template>
  <section class="mb-page-view" :aria-label="`Page: ${title}`">
    <header class="mb-page-view__bar">
      <MercbotIconButton icon="$close" label="Close page" @click="emit('close')" />
      <span class="mb-page-view__chip">
        <v-icon icon="$book2" size="16" />
        <span class="mb-page-view__title">{{ title }}</span>
      </span>
      <button v-if="html" type="button" class="mb-page-view__share" @click="shareOpen = true">
        <v-icon icon="$iosShare" size="16" /> Share
      </button>
      <v-menu location="bottom end" :offset="6" content-class="mb-popover">
        <template #activator="{ props: menuProps }">
          <MercbotIconButton v-bind="menuProps" icon="$moreHoriz" label="More" />
        </template>
        <v-list class="py-1" width="220" density="compact">
          <v-list-item v-if="html" prepend-icon="$history" title="Versions" @click="versionsOpen = true" />
          <v-list-item prepend-icon="$download" title="Download a copy" :href="copyUrl" />
        </v-list>
      </v-menu>
    </header>
    <div class="mb-page-view__body" :style="{ paddingBottom: `${bottom + 24}px` }">
      <div class="mb-page-view__sheet" :style="{ background: PAPER }">
        <MercbotPageFrame v-if="html" ref="frame" :bot-id="botId" :path="path" @open-app="openApp" @failure="emit('failure', $event)" />
        <MercbotMarkdownPage v-else :key="stamp" :bot-id="botId" :path="path" :group="group" />
      </div>
    </div>
    <template v-if="html">
      <MercbotPageShare v-model="shareOpen" :bot-id="botId" :path="path" :title="title" @copied="emit('toast', $event)" />
      <MercbotPageVersions v-model="versionsOpen" :bot-id="botId" :path="path" :title="title" :bot-name="botName" :me="me" @restored="restored" />
    </template>
  </section>
</template>

<style scoped>
.mb-page-view {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: rgb(var(--v-theme-background));
}

.mb-page-view__bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
}

.mb-page-view__chip {
  display: inline-flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
}

.mb-page-view__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-page-view__share {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 16px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.mb-page-view__body {
  flex: 1;
  min-height: 0;
  padding: 0 16px;
  overflow-y: auto;
}

.mb-page-view__sheet {
  max-width: 900px;
  margin: 0 auto;
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
}

@media (max-width: 600px) {
  .mb-page-view__body {
    padding: 0;
  }

  .mb-page-view__sheet {
    border-width: 1px 0;
    border-radius: 0;
  }
}
</style>
