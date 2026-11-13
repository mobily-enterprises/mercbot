<script setup>
import { computed, provide, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDisplay } from "vuetify";
import ShellUpButton from "@jskit-ai/shell-web/client/components/ShellUpButton";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import AppDetailsPanel from "@/components/apps/AppDetailsPanel.vue";
import AppNode from "@/components/apps/AppNode.vue";
import AppTheme from "@/components/apps/AppTheme.vue";
import { appsApi, errorText } from "@/components/apps/appsApi.js";
import { ICON_PATHS, createScreenRuntime, previewNotice, screenLocation as addressOf, screenParams } from "@/components/apps/appRuntime.js";
import { withNamedFormulas } from "@local/apps/shared";
import { browserFunctions } from "@/components/apps/scriptFunctions.js";
import { askInChat } from "@/components/apps/askInChat.js";
import { useLiveData } from "@/components/apps/useLiveData.js";
import ViewActions from "@/components/apps/ViewActions.vue";
import { botsApi } from "@/components/mercbot/botsApi.js";
import { useAppStyle } from "@/components/apps/useAppStyle.js";
import { closestElement } from "@/browser.js";
import { APP_AREA_KEY, APP_SCREEN_KEY } from "@/components/apps/screenKeys.js";
import { useSnackbar } from "@/components/apps/useSnackbar.js";

// An app in its own frame (D-35): /w/<home>/apps/<app>/<screen>/<record id>. Its navigation is
// the app's own (rail, tabs, or a bottom bar on phones). ?version=draft previews the draft on its
// practice data (D-71): a copy of the live records where its buttons save and change things as the
// live app would, with Reset to start again from the live records and Publish for the person to decide.
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
const publishing = ref(false);
const resetting = ref(false);
const details = ref(false);
const pointing = ref(false);
const highlight = ref(null);
const builder = ref(null);
const canManage = ref(false);
appsApi.builder().then((result) => {
  builder.value = result.builder;
  canManage.value = result.canManage;
}, () => {});

const definition = computed(() => loaded.value?.definition);
// A view on its own page (D-55): live, with what people do with a view instead of an app's tools.
const isView = computed(() => loaded.value?.app?.kind === "view");
// The catch-all arrives as one string ("person/12") or a list, depending on the route.
const pathParts = computed(() => [].concat(route.params.path || []).flatMap((part) => String(part).split("/")).filter(Boolean).map(decodeURIComponent));
const screenKey = computed(() => (definition.value?.screens?.[pathParts.value[0]] ? pathParts.value[0] : definition.value?.home));
const screen = computed(() => definition.value?.screens?.[screenKey.value]);
const navItems = computed(() => definition.value?.navigation?.items || []);
const navStyle = computed(() => (smAndDown.value ? "bottom" : definition.value?.navigation?.style || "rail"));

// A screen's address in this app; a draft preview stays a draft preview.
function screenLocation(key, params = {}) {
  const location = addressOf(definition.value?.screens, paths.page(`/apps/${slug.value}`), key, params);
  return { ...location, query: { ...location.query, ...(version.value === "draft" ? { version: "draft" } : {}) } };
}

// A note handed over by the page that opened this app (say, after installing a template).
if (window.history.state?.notice?.text) notify(window.history.state.notice.text, window.history.state.notice.color);

function onEffects(result) {
  for (const effect of result.effects || []) {
    if (effect.go) router.push(screenLocation(effect.go.screen, effect.go.params));
    else if (effect.notify) notify(effect.notify);
    else if (effect.openDialog) runtime.value.dialogs[`dialog:${effect.openDialog}`] = true;
    else if (effect.closeDialog) runtime.value.dialogs[`dialog:${effect.closeDialog}`] = false;
  }
  const notice = previewNotice(result);
  if (notice) notify(notice);
}
const onError = (error) => notify(errorText(error, "That didn't work. Try again."), "error");

async function loadApp() {
  problem.value = "";
  loaded.value = null;
  try {
    const next = await appsApi.get(slug.value, version.value);
    // The app's named formulas (D-78) and script functions, callable from its formulas.
    functions.value = withNamedFormulas(next.definition?.formulas, await browserFunctions(next.functions).catch(() => null));
    loaded.value = next;
    if (!loaded.value.definition) problem.value = version.value === "draft" ? "This app has no draft." : "This app hasn't been published yet.";
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
  const next = createScreenRuntime({ slug: slug.value, version: version.value, tables: loaded.value.tables, screen: screen.value, screens: definition.value.screens, screenKey: screenKey.value, params: screenParams(definition.value.screens, screenKey.value, pathParts.value, route.query), onEffects, onError, functions: functions.value });
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
useLiveData(computed(() => (isView.value ? runtime.value : null)));

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
    await router.push({ path: route.path, query: { version: "draft" } });
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

// Ask Builder (D-35): opens the chat with the Builder, with a first line saying which app, screen
// and (with Point and ask) part this is about, ready to finish and send. A shared Builder has one
// conversation per app (owner, 2026-10-30), and that's the one that opens. When the Builder isn't
// shared yet, an owner or admin is asked once whether to make it so; otherwise, and after a no,
// the person's own chat opens as before.
const roomsQuestion = ref(null);
const ASKED = "mercbot.builder-rooms-asked";
const alreadyAsked = (botId) => {
  try {
    return (JSON.parse(window.localStorage.getItem(ASKED) || "[]") || []).includes(botId);
  } catch {
    return false;
  }
};
function rememberAsked(botId) {
  try {
    window.localStorage.setItem(ASKED, JSON.stringify([...new Set([...(JSON.parse(window.localStorage.getItem(ASKED) || "[]") || []), botId])]));
  } catch {
    // Without storage it may ask again next time.
  }
}
async function appRoom() {
  if (!builder.value.shared && canManage.value && !alreadyAsked(builder.value.id)) {
    const yes = await new Promise((resolve) => (roomsQuestion.value = { resolve }));
    roomsQuestion.value = null;
    rememberAsked(builder.value.id);
    if (yes) {
      await botsApi.update(builder.value.id, { sharing: "shared" });
      builder.value = { ...builder.value, shared: true };
    }
  }
  if (builder.value.shared) await botsApi.roomForApp(builder.value.id, { appId: loaded.value.app.id, title: loaded.value.app.name });
}

async function askBuilder(part = null, about = "") {
  pointing.value = false;
  highlight.value = null;
  if (!builder.value) return notify("Choose a Builder first: New app in Apps, or Make this the Builder in a bot's Details.", "error");
  await appRoom().catch((error) => notify(errorText(error, "The app's conversation couldn't open; your own chat with the Builder opens instead."), "error"));
  const where = part ? `, the ${part.type}${part.label ? ` "${part.label}"` : ""} (${part.path})` : "";
  const line = about ? `About the app "${loaded.value.app.name}" (${slug.value}), ${about}` : `About the app "${loaded.value.app.name}" (${slug.value}), screen "${screenKey.value}"${where}: `;
  askInChat(router, { chat: paths.page("/"), botId: builder.value.id, line });
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
          <v-avatar v-else :color="loaded.app.color" size="28" rounded="lg"><v-icon :icon="ICON_PATHS[loaded.app.icon] || ICON_PATHS.apps" size="18" color="white" /></v-avatar>
          <span class="text-subtitle-1 font-weight-medium">{{ loaded.app.name }}</span>
          <v-spacer />
          <ViewActions
            v-if="isView"
            :loaded="loaded"
            :full-page-link="false"
            @restored="loadApp().then(openScreen)"
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
              :to="screenLocation(item.screen)"
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
            <v-tab v-for="item in navItems" :key="item.screen" :value="item.screen" :to="screenLocation(item.screen)" :prepend-icon="ICON_PATHS[item.icon]">{{ item.label }}</v-tab>
          </v-tabs>

          <v-card v-if="problem" flat class="pa-6 text-body-1">{{ problem }}</v-card>
          <div v-else-if="!loaded || (screen && runtime?.screen !== screen)" class="d-flex flex-column ga-4">
            <v-skeleton-loader type="heading" width="280" />
            <v-skeleton-loader type="table-tbody" />
          </div>
          <v-card v-else-if="!screen" flat class="pa-6">That screen doesn't exist in this app.</v-card>
          <div v-else :key="runs" class="d-flex flex-column ga-4">
            <AppNode v-for="(node, index) in screen.content" :key="index" :node="node" :path="`content/${index}`" />
          </div>
        </main>
      </div>

      <v-bottom-navigation v-if="navItems.length && navStyle === 'bottom'" :model-value="screenKey" grow>
        <v-btn v-for="item in navItems.slice(0, 5)" :key="item.screen" :value="item.screen" :to="screenLocation(item.screen)">
          <v-icon :icon="ICON_PATHS[item.icon] || ICON_PATHS.apps" />
          <span>{{ item.label }}</span>
        </v-btn>
      </v-bottom-navigation>
    </AppTheme>

    <v-navigation-drawer v-if="loaded?.app" v-model="details" location="right" temporary width="440">
      <AppDetailsPanel :loaded="loaded" :home="home" @restored="(result) => { notify(`Restored as version ${result.number}.`); loadApp().then(openScreen); }" @narrowed="(result) => { notify(`Saved as version ${result.number}.`); loadApp().then(openScreen); }" @failed="(message) => notify(message, 'error')" @themed="() => { notify('Saved.'); loadApp().then(openScreen); }" @ask="(about) => askBuilder(null, about)" />
    </v-navigation-drawer>

    <v-dialog :model-value="Boolean(roomsQuestion)" max-width="460" persistent>
      <v-card v-if="roomsQuestion && builder" rounded="lg" class="pa-4">
        <div class="text-subtitle-1 mb-2">A conversation for each app?</div>
        <div class="text-body-2 mb-4">{{ builder.name }} can keep a separate conversation for each app, which everyone in the home can follow. That makes {{ builder.name }} shared: in those conversations it doesn't use anyone's own accounts or memories.</div>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="roomsQuestion.resolve(false)">No, use my own chat</v-btn>
          <v-btn color="primary" variant="flat" @click="roomsQuestion.resolve(true)">Yes, one per app</v-btn>
        </div>
      </v-card>
    </v-dialog>
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
