<script setup>
import { computed, provide, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDisplay } from "vuetify";
import ShellUpButton from "@jskit-ai/shell-web/client/components/ShellUpButton";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import AppDetailsPanel from "@/components/apps/AppDetailsPanel.vue";
import AppTile from "@/components/apps/AppTile.vue";
import AppNode from "@/components/apps/AppNode.vue";
import AppTheme from "@/components/apps/AppTheme.vue";
import AppCelebration from "@/components/apps/AppCelebration.vue";
import MercbotConfirmDialog from "@/components/mercbot/MercbotConfirmDialog.vue";
import { appsApi, errorText } from "@/components/apps/appsApi.js";
import { ICON_PATHS, createScreenRuntime, previewNotice, screenLocation as addressOf, screenParams } from "@/components/apps/appRuntime.js";
import { expandLines, useTimeZoneSource, withNamedFormulas } from "@local/apps/shared";
import { browserFunctions } from "@/components/apps/scriptFunctions.js";
import { askBuilder as openBuilderChat } from "@/components/apps/askInChat.js";
import { useLiveData } from "@/components/apps/useLiveData.js";
import ViewActions from "@/components/apps/ViewActions.vue";
import { useAppExit } from "@/components/apps/useAppExit.js";
import { useAppStyle } from "@/components/apps/useAppStyle.js";
import { closestElement } from "@/browser.js";
import { APP_AREA_KEY, APP_SCREEN_KEY } from "@/components/apps/screenKeys.js";
import { useSnackbar } from "@/components/apps/useSnackbar.js";

// An app in its own frame (D-35): /w/<home>/apps/<app>/<screen>/<record id>. Its navigation is
// the app's own (rail, tabs, or a bottom bar on phones). ?version=draft previews the draft on its
// practice data (D-71): a copy of the live records where its buttons save and change things as the
// live app would, with Reset to start again from the live records and Publish for the person to decide. The shell's
// button first in its bar is the app's close, named for where it goes: one step out of the whole apps area, back to
// where the person entered it from (D-106, D-123). Moving between the app's own places (its screens, records and
// navigation, live and draft) replaces the open history entry, so an app never stacks entries: Back from where its
// close lands goes at most to Apps, never into the app.
const route = useRoute();
const router = useRouter();
const { smAndDown } = useDisplay();
const paths = usePaths();

const home = computed(() => String(route.params.workspaceSlug || ""));
const slug = computed(() => String(route.params.slug || ""));
const version = computed(() => (route.query.version === "draft" ? "draft" : "live"));
const loaded = shallowRef(null);
const functions = shallowRef(null);
const problem = ref("");
const runtime = shallowRef(null);
const { snackbar, notify } = useSnackbar();
// How long a celebration plays before it goes (D-143).
const CELEBRATION_MS = 2600;
useAppExit();
const publishing = ref(false);
const resetting = ref(false);
const details = ref(false);
const pointing = ref(false);
const highlight = ref(null);
const builder = ref(null);
appsApi.builder().then((result) => {
  builder.value = result.builder;
}, () => {});

const definition = computed(() => loaded.value?.definition);
// A view on its own page (D-55): live, with what people do with a view instead of an app's tools.
const isView = computed(() => loaded.value?.app?.kind === "view");
// The catch-all arrives as one string ("person/12") or a list, depending on the route.
const pathParts = computed(() => [].concat(route.params.path || []).flatMap((part) => String(part).split("/")).filter(Boolean).map(decodeURIComponent));
const screenKey = computed(() => (definition.value?.screens?.[pathParts.value[0]] ? pathParts.value[0] : definition.value?.home));
// A screen as it runs: its line items as the parts they stand for (lines.js), as the server runs it.
const screen = computed(() => expandLines(definition.value?.screens?.[screenKey.value]));
const navItems = computed(() => definition.value?.navigation?.items || []);
const navStyle = computed(() => (smAndDown.value ? "bottom" : definition.value?.navigation?.style || "rail"));

// A screen's address in this app; a draft preview stays a draft preview.
function screenLocation(key, params = {}) {
  const location = addressOf(definition.value?.screens, paths.page(`/apps/${slug.value}`), key, params);
  return { ...location, query: { ...location.query, ...(version.value === "draft" ? { version: "draft" } : {}) } };
}

// A note handed over by the page that opened this app (say, after installing a template).
if (window.history.state?.notice?.text) notify(window.history.state.notice.text, window.history.state.notice.color);

// Changes in connected apps a button asked for that the person's approval rules ask about (D-136): confirmed one at a
// time, then made as them.
const confirming = ref([]);
const askingConfirm = computed({
  get: () => confirming.value.length > 0,
  set: (open) => {
    if (!open) confirming.value = confirming.value.slice(1);
  }
});
async function confirmConnected() {
  const { id } = confirming.value[0];
  try {
    notify((await appsApi.confirmConnected(slug.value, id)).done);
  } catch (error) {
    onError(error);
  }
}

// A button's celebration (D-143): its words and confetti over the app's area, for as long as they play.
const celebration = ref(null);
let celebrationTimer = null;
function celebrate(message) {
  clearTimeout(celebrationTimer);
  celebration.value = { message, key: (celebration.value?.key ?? 0) + 1 };
  celebrationTimer = setTimeout(() => (celebration.value = null), CELEBRATION_MS);
}

function onEffects(result) {
  for (const effect of result.effects || []) {
    if (effect.confirmConnected) confirming.value = [...confirming.value, effect.confirmConnected];
    else if (effect.go) router.replace(screenLocation(effect.go.screen, effect.go.params));
    else if (effect.notify) notify(effect.notify);
    else if (effect.celebrate !== undefined) celebrate(effect.celebrate);
    else if (effect.set) runtime.value.state[effect.set.state] = effect.set.value;
    else if (effect.openDialog) runtime.value.dialogs[`dialog:${effect.openDialog}`] = true;
    else if (effect.closeDialog) runtime.value.dialogs[`dialog:${effect.closeDialog}`] = false;
  }
  const notice = previewNotice(result);
  if (notice) notify(notice);
}
const onError = (error) => notify(errorText(error, "That didn't work. Try again."), "error");

// After a restore or a saved change: the app is read again and its screen opens afresh.
const reopenApp = () => loadApp().then(openScreen);

async function loadApp() {
  problem.value = "";
  loaded.value = null;
  try {
    const next = await appsApi.get(slug.value, version.value);
    // The app's named formulas (D-78) and script functions, callable from its formulas.
    functions.value = withNamedFormulas(next.definition?.formulas, await browserFunctions(next.functions).catch(() => null));
    // "Today" in the app's formulas is in the home's time zone (D-140).
    useTimeZoneSource(() => next.timeZone || "UTC");
    loaded.value = next;
    if (!loaded.value.definition) {
      problem.value = version.value === "draft" ? "This app has no draft." : "This app hasn't been published yet.";
    }
  } catch (error) {
    // An address that answers 404 may have been an app or a view; it says neither as a guess.
    problem.value = error?.status === 404 ? "There's no app or view at this address in this home. A view may have been retired." : "This couldn't load. Try again.";
  }
}

let stopFollowing = null;
// Each screen runtime starts the screen's parts again, after Reset too: a view on it reads through a runtime of its
// own, which stopped with the one before.
const runs = ref(0);
function openScreen() {
  // The screen before this one reads nothing more, even what it was still waiting for.
  runtime.value?.stop();
  stopFollowing?.();
  stopFollowing = null;
  if (!screen.value) {
    runtime.value = null;
    return;
  }
  const next = createScreenRuntime({ slug: slug.value, version: version.value, tables: loaded.value.tables, screen: screen.value, screens: definition.value.screens, screenKey: screenKey.value, params: screenParams(definition.value.screens, screenKey.value, pathParts.value, route.query), onEffects, onError, functions: functions.value, me: loaded.value.me ?? null, people: loaded.value.people ?? [] });
  runtime.value = next;
  runs.value += 1;
  next.loadAll();
  stopFollowing = next.followState();
}

// An address without an app is the one leaving it (Back to a chat or a page): this view is going,
// and asks nothing of an app with no name, even when the app it was loading answers after that.
watch([slug, version], async ([name]) => {
  if (!name) return;
  await loadApp();
  if (slug.value === name) openScreen();
}, { immediate: true });
watch(() => route.fullPath, (next, previous) => {
  if (slug.value && loaded.value && next.split("?")[0] !== previous?.split("?")[0]) openScreen();
});

provide(APP_SCREEN_KEY, new Proxy({}, { get: (_target, key) => runtime.value?.[key] }));
// Every running screen, an app's as a view's, re-reads what changed in the home's tables (D-55, D-144): a job, a bot or
// someone else's change shows without reloading.
useLiveData(computed(() => runtime.value));

// A copy of a view whose original has moved on (D-55): the app asks, once per new version.
const SKIPPED = "mercbot.view-copies-skipped";
const skipped = ref((() => {
  try {
    return JSON.parse(window.localStorage.getItem(SKIPPED) || "{}") || {};
  } catch {
    return {};
  }
})());
const skipKey = (update) => `${slug.value}/${update.screen}`;
const copyUpdate = computed(() => (version.value === "live" ? (loaded.value?.copyUpdates || []).find((update) => skipped.value[skipKey(update)] !== update.to) : null));
function skipCopyUpdate(update) {
  skipped.value = { ...skipped.value, [skipKey(update)]: update.to };
  try {
    window.localStorage.setItem(SKIPPED, JSON.stringify(skipped.value));
  } catch {
    // Without storage it may ask again next time.
  }
}
const updatingCopy = ref(false);
async function updateCopy(update) {
  updatingCopy.value = true;
  try {
    await appsApi.updateCopy(slug.value, update.screen);
    await router.replace({ path: route.path, query: { version: "draft" } });
  } catch (error) {
    onError(error);
  } finally {
    updatingCopy.value = false;
  }
}
// The app's own CSS applies to its area (navigation and screens), never Mercbot's bar above it;
// its dialogs open inside that area too.
useAppStyle(computed(() => loaded.value?.style || ""));
provide(APP_AREA_KEY, computed(() => (loaded.value?.app ? `[data-app-style="${loaded.value.app.id}"]` : null)));

// Ask Builder (D-35, D-41): opens the app's chat with the Builder, public and named after the app, with a first line
// saying which screen and (with Point and ask) part this is about, ready to finish and send.
async function askBuilder(part = null, about = "") {
  pointing.value = false;
  highlight.value = null;
  if (!builder.value) return notify("Choose a Builder first: New app in Apps, or choose one in Settings, under Main bot and Builder.", "error");
  const where = part ? `, the ${part.type}${part.label ? ` "${part.label}"` : ""} (${part.path})` : "";
  const line = about ? `About the app "${loaded.value.app.name}" (${slug.value}), ${about}` : `About the app "${loaded.value.app.name}" (${slug.value}), screen "${screenKey.value}"${where}: `;
  await openBuilderChat(router, { chat: paths.page("/"), appSlug: slug.value, line })
    .catch((error) => notify(errorText(error, "The app's chat with the Builder couldn't open. Try again."), "error"));
}

function partAt(event) {
  const element = closestElement(event.target, "[data-app-path]");
  return element ? { element, path: element.dataset.appPath, type: element.dataset.appType, label: element.dataset.appLabel } : null;
}
function onPointMove(event) {
  if (!pointing.value) return;
  const part = partAt(event);
  const box = part?.element.firstElementChild?.getBoundingClientRect();
  highlight.value = box ? { top: `${box.top}px`, left: `${box.left}px`, width: `${box.width}px`, height: `${box.height}px` } : null;
}
function onPointClick(event) {
  if (!pointing.value) return;
  event.preventDefault();
  event.stopPropagation();
  const part = partAt(event);
  if (part) askBuilder(part);
}

// Reset: the practice data starts again from the live records as they are now.
async function resetPractice() {
  resetting.value = true;
  // Reads still on their way read the copy Reset clears (D-71): they stop, and the screen reads the new copy after.
  runtime.value?.stop();
  try {
    await appsApi.resetPractice(slug.value);
    notify("Practice data reset: it's a fresh copy of the live records.");
  } catch (error) {
    onError(error);
  } finally {
    openScreen();
    resetting.value = false;
  }
}

async function publish() {
  publishing.value = true;
  // The draft's reads still on their way are no longer needed, and publishing clears the copy they read (D-71).
  runtime.value?.stop();
  try {
    const result = await appsApi.publish(slug.value);
    notify(`Published as version ${result.number}.`);
    await router.replace({ path: route.path });
  } catch (error) {
    onError(error);
    // Still a draft: its screen reads again.
    openScreen();
  } finally {
    publishing.value = false;
  }
}
</script>

<template>
  <div class="app-frame">
    <!-- The app's own look; the details drawer and notices stay in Mercbot's. -->
    <AppTheme :theme="loaded?.theme" class="app-frame__themed">
      <header class="app-frame__bar">
        <ShellUpButton />
        <template v-if="loaded?.app">
          <v-img v-if="loaded.theme?.logo" :src="loaded.theme.logo" alt="" width="28" height="28" max-width="28" contain />
          <AppTile v-else :icon="loaded.app.icon" :color="loaded.app.color" :picture="loaded.app.picture" :size="28" />
          <span class="text-subtitle-1 font-weight-medium">{{ loaded.app.name }}</span>
          <v-spacer />
          <ViewActions
            v-if="isView"
            :loaded="loaded"
            :full-page-link="false"
            @restored="reopenApp"
            @retired="router.push(paths.page('/apps'))"
          />
          <template v-else>
            <v-btn prepend-icon="$smartToy" variant="text" size="small" @click="askBuilder()">Ask Builder</v-btn>
            <v-btn icon="$adsClick" :variant="pointing ? 'tonal' : 'text'" :color="pointing ? 'primary' : undefined" size="small" aria-label="Point and ask" @click="pointing = !pointing; highlight = null" />
            <v-btn icon="$info" variant="text" size="small" aria-label="App details" @click="details = !details" />
          </template>
        </template>
        <v-skeleton-loader v-else type="text" width="160" />
      </header>

      <v-alert v-if="copyUpdate" type="info" variant="tonal" density="compact" rounded="0" class="app-frame__draft">
        <div class="d-flex align-center flex-wrap ga-3">
          <span>"{{ copyUpdate.title }}" has changed since this app copied it. Update it? You'll preview the change before anyone else sees it.</span>
          <v-spacer />
          <v-btn variant="text" size="small" @click="skipCopyUpdate(copyUpdate)">Not now</v-btn>
          <v-btn color="primary" variant="flat" size="small" :disabled="updatingCopy" @click="updateCopy(copyUpdate)">Update</v-btn>
        </div>
      </v-alert>

      <v-alert v-if="version === 'draft' && loaded?.version?.draft" type="info" variant="tonal" density="compact" rounded="0" class="app-frame__draft">
        <div class="d-flex align-center flex-wrap ga-3">
          <div>
            <div>Practice data: changes here are thrown away when you publish.</div>
            <div v-if="loaded.version.summary" class="text-body-2 text-medium-emphasis">Draft: {{ loaded.version.summary }}</div>
          </div>
          <v-spacer />
          <v-btn variant="text" size="small" :disabled="resetting || publishing" @click="resetPractice">{{ resetting ? "Resetting…" : "Reset" }}</v-btn>
          <v-btn color="primary" variant="flat" size="small" :disabled="publishing || resetting" @click="publish">{{ publishing ? "Publishing…" : "Publish" }}</v-btn>
        </div>
      </v-alert>

      <div class="app-frame__body" :data-app-style="loaded?.app?.id" :data-screen="screenKey">
        <nav v-if="navItems.length && navStyle === 'rail'" class="app-frame__rail" aria-label="App">
          <v-list density="comfortable" nav>
            <v-list-item
              v-for="item in navItems"
              :key="item.screen"
              :to="screenLocation(item.screen)" replace
              :active="item.screen === screenKey"
              :prepend-icon="ICON_PATHS[item.icon]"
              :title="item.label"
              rounded="xl"
            />
          </v-list>
        </nav>

        <main class="app-frame__main" :class="{ 'app-frame__main--pointing': pointing }" @click.capture="onPointClick" @mousemove="onPointMove">
          <v-alert v-if="pointing" type="info" variant="tonal" density="compact" class="mb-4">Click the part of the screen you want to ask the Builder about.</v-alert>
          <div v-if="pointing && highlight" class="app-frame__highlight" :style="highlight" />
          <v-tabs v-if="navItems.length && navStyle === 'tabs'" :model-value="screenKey" color="primary" class="mb-4">
            <v-tab v-for="item in navItems" :key="item.screen" :value="item.screen" :to="screenLocation(item.screen)" replace :prepend-icon="ICON_PATHS[item.icon]">{{ item.label }}</v-tab>
          </v-tabs>

          <v-card v-if="problem" flat class="pa-6 text-body-1" data-testid="app-frame-problem">
            {{ problem }}
            <!-- Opened live (a pin, a link) with only a draft: the draft is one step away, and it's published from there. -->
            <template v-if="version === 'live' && !loaded?.definition && loaded?.app?.draftVersionId">
              <div class="text-body-2 text-on-surface-variant mt-2">Its draft is ready: open it to try it, then publish it from there.</div>
              <v-btn color="primary" variant="flat" class="mt-4" :to="{ path: route.path, query: { version: 'draft' } }" replace>Open the draft</v-btn>
            </template>
          </v-card>
          <div v-else-if="!loaded || (screen && runtime?.screen !== screen)" class="d-flex flex-column ga-4">
            <v-skeleton-loader type="heading" width="280" />
            <v-skeleton-loader type="table-tbody" />
          </div>
          <v-card v-else-if="!screen" flat class="pa-6">That screen doesn't exist in this app.</v-card>
          <div v-else :key="runs" class="d-flex flex-column ga-4">
            <AppNode v-for="(node, index) in screen.content" :key="index" :node="node" :path="`content/${index}`" />
          </div>
        </main>
        <AppCelebration v-if="celebration" :key="celebration.key" :message="celebration.message" />
      </div>

      <v-bottom-navigation v-if="navItems.length && navStyle === 'bottom'" :model-value="screenKey" grow>
        <v-btn v-for="item in navItems.slice(0, 5)" :key="item.screen" :value="item.screen" :to="screenLocation(item.screen)" replace>
          <v-icon :icon="ICON_PATHS[item.icon] || ICON_PATHS.apps" />
          <span>{{ item.label }}</span>
        </v-btn>
      </v-bottom-navigation>
    </AppTheme>

    <v-navigation-drawer v-if="loaded?.app" v-model="details" location="right" temporary width="440">
      <AppDetailsPanel :loaded="loaded" :home="home" @restored="(result) => { notify(`Restored as version ${result.number}.`); reopenApp(); }" @narrowed="(result) => { notify(`Saved as version ${result.number}.`); reopenApp(); }" @failed="(message) => notify(message, 'error')" @themed="() => { notify('Saved.'); reopenApp(); }" @ask="(about) => askBuilder(null, about)" />
    </v-navigation-drawer>

    <MercbotConfirmDialog
      v-model="askingConfirm"
      :title="confirming[0]?.question || ''"
      text="It's done as you, in this app's connected account."
      confirm-label="Confirm"
      :danger="false"
      @confirm="confirmConnected"
    />
    <v-snackbar v-model="snackbar.open" :color="snackbar.color" timeout="3000">{{ snackbar.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.app-frame {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.app-frame__themed {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.app-frame__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.app-frame__main--pointing {
  cursor: crosshair;
}
.app-frame__highlight {
  position: fixed;
  pointer-events: none;
  border: 2px solid rgb(var(--v-theme-primary));
  border-radius: 8px;
  z-index: 10;
}
.app-frame__draft {
  flex: 0 0 auto;
}
.app-frame__body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}
@media (max-width: 600px) {
  .app-frame__bar > .view-actions {
    flex-basis: 100%;
  }
}
.app-frame__rail {
  width: 220px;
  flex-shrink: 0;
  padding: 8px;
  border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.app-frame__main {
  flex: 1;
  min-width: 0;
  padding: 24px;
  max-width: 1200px;
}
</style>
