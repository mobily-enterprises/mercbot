<script setup>
import { computed, onMounted, ref } from "vue";
import { appsApi } from "@/components/apps/appsApi.js";
import MercbotSettingsSelect from "./MercbotSettingsSelect.vue";
import { botsApi } from "./botsApi.js";
import { builderBotId } from "./builderBot.js";

// Settings → Main bot and Builder (D-119): which of the home's bots is its main bot (the one that can't be archived)
// and which builds its apps (D-35). The home's owners and admins choose, with the server's rules as before (PATCH
// bots/:id { main: true }, PUT builder); everyone else reads them. Each bot's card shows a chip when it is one, and
// links here.
defineProps({
  // Whether the person is one of the home's owners or admins.
  manages: { type: Boolean, default: false }
});
// `changed`: the main bot changed, so the home's bots (the sidebar, each card's chip) are read again.
const emit = defineEmits(["failure", "notify", "changed"]);

const bots = ref(null);
const builder = ref(null);
const canBuild = ref(false);
const saving = ref(false);

async function load() {
  try {
    const [listed, built] = await Promise.all([botsApi.list(), appsApi.builder()]);
    bots.value = listed.bots.filter((bot) => !bot.archivedAt);
    builder.value = built.builder;
    canBuild.value = Boolean(built.canManage);
  } catch (error) {
    bots.value = [];
    emit("failure", error);
  }
}
onMounted(load);

const options = computed(() => (bots.value || []).map((bot) => ({ value: String(bot.id), label: bot.name })));
const nameOf = (id) => options.value.find((option) => option.value === id)?.label || "";
const mainId = computed(() => String((bots.value || []).find((bot) => bot.isMain)?.id ?? ""));
const builderId = computed(() => (builder.value ? String(builder.value.id) : ""));
const builderOptions = computed(() => (builderId.value ? options.value : [{ value: "", label: "No bot yet" }, ...options.value]));

async function chooseMain(botId) {
  if (!botId || botId === mainId.value || saving.value) return;
  saving.value = true;
  try {
    await botsApi.update(botId, { main: true });
    bots.value = bots.value.map((bot) => ({ ...bot, isMain: String(bot.id) === botId }));
    emit("changed");
    emit("notify", `${nameOf(botId)} is now the main bot`);
  } catch (error) {
    emit("failure", error);
  } finally {
    saving.value = false;
  }
}

async function chooseBuilder(botId) {
  if (!botId || botId === builderId.value || saving.value) return;
  saving.value = true;
  try {
    builder.value = (await appsApi.setBuilder(botId)).builder;
    builderBotId.value = builder.value?.id ?? null;
    emit("notify", `${nameOf(botId)} now builds the apps`);
  } catch (error) {
    emit("failure", error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section v-if="bots" aria-label="Main bot and Builder">
    <div class="mb-set-card">
      <div class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Main bot</span>
          <span class="mb-set-row__description">It can't be archived.</span>
        </span>
        <MercbotSettingsSelect
          v-if="manages && options.length"
          :model-value="mainId"
          :options="options"
          label="Main bot"
          @update:model-value="chooseMain"
        />
        <span v-else class="mb-main-set__value" data-main-bot>{{ nameOf(mainId) || "None" }}</span>
      </div>
      <div class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Builder</span>
          <span class="mb-set-row__description">It makes and changes the home's apps.</span>
        </span>
        <MercbotSettingsSelect
          v-if="canBuild && options.length"
          :model-value="builderId"
          :options="builderOptions"
          label="Builder"
          @update:model-value="chooseBuilder"
        />
        <span v-else class="mb-main-set__value" data-builder>{{ builder?.name || "No bot yet" }}</span>
      </div>
    </div>
    <p v-if="!manages" class="mb-set-caption">Only the home's owners and admins can change these.</p>
  </section>
</template>

<style scoped>
.mb-main-set__value {
  flex: none;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
