<script setup>
import { useDisplay } from "vuetify";
import { computed, ref, watch } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotPluginLogo from "./MercbotPluginLogo.vue";
import { openSignIn, pluginsApi } from "./pluginsApi.js";
import { sleep } from "./botsApi.js";
import { useHomes } from "./homesApi.js";
import { useAppAccounts } from "./useAppAccounts.js";
import { usePrivateSkill } from "./usePrivateSkill.js";
import { useSignInWatch } from "./useSignInWatch.js";
import {
  BADGES,
  MAIN_CATEGORIES,
  MORE_CATEGORIES,
  NEEDS,
  OVERVIEW_LIMIT,
  accountTitle,
  actionLabel,
  availability,
  catalogueSections,
  enabledCount,
  parts,
  searchApps,
  searchCategories,
  signsIn,
  working,
  worstState
} from "./appsCatalogue.js";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

// Connect apps and skills: catalogue, app detail, Manage and private skill pages in one modal.
// On a phone it fills the screen (D-36 UX bar).
const paths = usePaths();
const display = useDisplay();
const phone = computed(() => display.width.value < 600);
const props = defineProps({
  mainBot: { type: Object, default: null },
  // Opens straight on one private skill, as from a skill link in the chat,
  // or on one app's page, as from the search palette.
  skillId: { type: String, default: "" },
  appId: { type: String, default: "" }
});
const open = defineModel({ type: Boolean, default: false });
const emit = defineEmits(["failure"]);

const plugins = ref([]);
const skills = ref([]);
const loaded = ref(false);
const page = ref("catalogue");
const category = ref("All");
const query = ref("");
const currentId = ref("");
const busyId = ref("");
const busyLabel = ref("");
const toast = ref("");
// Home-wide accounts (D-37): owners and admins can add an account for everyone in the home.
const { current: currentHome } = useHomes();
const homeName = computed(() => currentHome.value?.name || "this home");
const managesHome = ref(false);
let toastTimer = null;
const onFailure = (error) => emit("failure", error);
const { skill, skillDraft, confirmingDelete, openSkill, skillChanged, saveSkill, deleteSkill } =
  usePrivateSkill({ skills, page, showToast, onFailure });
const {
  newAccountLabel, addingAccount, forHome, removingAccount, confirmingDisconnect, disconnect, removeAccount, canChange,
  startAddAccount, authorizeNewAccount, renamingAccountId, accountName, startAccountRename, commitAccountRename
} = useAppAccounts({ plugins, managesHome, signIn, onFailure });

async function load() {
  // The screen stays usable with the list it last had while this read is on its way, so an answer that came
  // meanwhile (Connect's, a sign-in's, a switch's) is newer than this read and stays.
  const shown = plugins.value;
  try {
    const result = await pluginsApi.list();
    if (plugins.value === shown) plugins.value = result.plugins;
    skills.value = result.skills;
    pasteSignIn.value = Boolean(result.pasteSignIn);
    managesHome.value = Boolean(result.managesHome);
  } catch (error) {
    emit("failure", error);
  }
  loaded.value = true;
}

watch(open, async (value) => {
  if (!value) return;
  page.value = "catalogue";
  category.value = "All";
  query.value = "";
  await load();
  const linked = props.skillId && skills.value.find((entry) => entry.id === props.skillId);
  const app = props.appId && plugins.value.find((plugin) => plugin.id === props.appId);
  if (app) openPlugin(app);
  else if (linked) openSkill(linked);
  else if (props.skillId) showToast("That skill has been deleted.");
}, { immediate: true });

// Coming-soon apps can't be signed in to, so they never count among the added ones.
const installed = computed(() => plugins.value.filter((plugin) => plugin.installed && !plugin.soon));
const current = computed(() => plugins.value.find((plugin) => plugin.id === currentId.value) || null);
const sections = computed(() => catalogueSections(plugins.value, category.value));
// Search: up to eight apps, then the categories that match.
const results = computed(() => searchApps(plugins.value, query.value));
const categoryResults = computed(() => searchCategories(query.value));

function showToast(text) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 5000);
}

function openPlugin(plugin) {
  currentId.value = plugin.id;
  addingAccount.value = false;
  confirmingDisconnect.value = "";
  removingAccount.value = "";
  toolsOpen.value = false;
  query.value = "";
  page.value = "detail";
}

// Adding shows "adding", then the account that still needs signing in, and opens the sign-in.
async function install(plugin) {
  busyId.value = plugin.id;
  busyLabel.value = "Adding…";
  try {
    const [result] = await Promise.all([pluginsApi.install(plugin.id), sleep(plugin.soon ? 400 : 1200)]);
    plugins.value = result.plugins;
    // A coming-soon app is only noted as wanted: its page explains (D-33).
    if (plugin.soon) openPlugin(plugin);
    else signIn(result.plugins.find((entry) => entry.id === plugin.id));
  } catch (error) {
    emit("failure", error);
  } finally {
    busyId.value = "";
  }
}

// The sign-in opens in a new tab (D-31) and the screen waits for the account (useSignInWatch).
const { pasteSignIn, pastedAddress, pasteProblem, finishing, watchSignIn, finishSignIn } = useSignInWatch({ open, plugins, showToast, reload: load });

function signIn(plugin, account = null) {
  const target = account || plugin.accounts.find((entry) => entry.status !== "connected") || plugin.accounts[0];
  openSignIn(paths.page("/connect", { surface: "account" }), plugin, target);
  if (pasteSignIn.value && page.value !== "detail") openPlugin(plugin);
  showToast(`Sign-in for ${plugin.name} opened in a new tab. Come back here once you're done.`);
  watchSignIn(plugin, target);
}

// The installed overview shows six apps, then "Show all N plugins".
const showAllInstalled = ref(false);
const shownInstalled = computed(() => (showAllInstalled.value ? installed.value : installed.value.slice(0, OVERVIEW_LIMIT)));

// Tools: what the bot can do with a connected app, each switchable; closed by default.
const toolsOpen = ref(false);

async function setAction(plugin, action) {
  const enabled = !action.enabled;
  plugins.value = plugins.value.map((entry) => (entry.id === plugin.id
    ? { ...entry, actions: entry.actions.map((item) => (item.id === action.id ? { ...item, enabled } : item)) }
    : entry));
  try {
    plugins.value = (await pluginsApi.setAction(plugin.id, action.id, enabled)).plugins;
  } catch (error) {
    emit("failure", error);
    await load();
  }
}

async function uninstall(plugin) {
  busyId.value = plugin.id;
  busyLabel.value = "Removing…";
  try {
    const [result] = await Promise.all([pluginsApi.uninstall(plugin.id), sleep(1000)]);
    plugins.value = result.plugins;
  } catch (error) {
    emit("failure", error);
  } finally {
    busyId.value = "";
  }
}

async function copyShareLink(plugin) {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/?connect=${encodeURIComponent(plugin.id)}`);
    showToast(`Link to ${plugin.name} copied.`);
  } catch (error) {
    emit("failure", error);
  }
}

function openTemplates() {
  window.open(paths.page("/", { surface: "templates" }), "_blank", "noopener");
}
</script>

<template>
  <v-dialog v-model="open" width="800" scrollable :fullscreen="phone">
    <div class="mb-apps-modal" :class="{ 'mb-apps-modal--phone': phone }">
      <button type="button" class="mb-apps-modal__close" aria-label="Close" @click="open = false">
        <v-icon icon="$close" size="18" />
      </button>

      <!-- Catalogue -->
      <div v-if="page === 'catalogue'" class="mb-apps-modal__page">
        <div class="mb-apps-modal__head">
          <h2 class="mb-apps-modal__title">Connect apps</h2>
          <button type="button" class="mb-apps-modal__summary" @click="page = 'manage'">
            <span class="mb-apps-modal__cluster">
              <MercbotPluginLogo v-for="plugin in installed.slice(0, 3)" :key="plugin.id" :plugin="plugin" :size="20" />
            </span>
            <span>{{ installed.length }} connected</span>
            <v-icon icon="$chevronRight" size="16" />
          </button>
        </div>

        <div class="mb-apps-modal__search-row">
          <div class="mb-apps-modal__search">
            <v-icon icon="$search" size="16" class="mb-apps-modal__search-icon" />
            <input v-model="query" aria-label="Search apps and skills" placeholder="Search apps and skills">
            <button v-if="query" type="button" class="mb-apps-modal__clear" @click="query = ''">Clear</button>
            <div v-if="query.trim()" class="mb-apps-modal__results" role="listbox">
              <template v-if="results.length || categoryResults.length">
                <p v-if="results.length" class="mb-apps-modal__results-label">Plugins</p>
                <button
                  v-for="plugin in results"
                  :key="plugin.id"
                  type="button"
                  class="mb-apps-modal__result"
                  @click="openPlugin(plugin)"
                >
                  <MercbotPluginLogo :plugin="plugin" :size="22" />
                  <span class="mb-apps-modal__result-name">{{ plugin.name }}</span>
                  <v-icon icon="$chevronRight" size="16" />
                </button>
                <p v-if="categoryResults.length" class="mb-apps-modal__results-label">Categories</p>
                <button
                  v-for="name in categoryResults"
                  :key="name"
                  type="button"
                  class="mb-apps-modal__result"
                  @click="category = name; query = ''"
                >
                  <span>{{ name }}</span>
                  <v-icon icon="$chevronRight" size="16" />
                </button>
              </template>
              <p v-else class="mb-apps-modal__no-results">Nothing matches “{{ query.trim() }}”.</p>
            </div>
          </div>
          <button type="button" class="mb-apps-modal__templates" @click="openTemplates">
            <MercbotAvatar v-if="mainBot" :bot="mainBot" :size="18" still />
            <span>Bot templates</span>
            <v-icon icon="$openInNew" size="14" />
          </button>
        </div>

        <div class="mb-apps-modal__chips">
          <button
            v-for="name in ['All', ...MAIN_CATEGORIES]"
            :key="name"
            type="button"
            class="mb-chip-filter"
            :class="{ 'mb-chip-filter--selected': category === name }"
            @click="category = name"
          >
            {{ name }}
          </button>
          <v-menu location="bottom start" :offset="4" content-class="mb-popover">
            <template #activator="{ props: moreProps }">
              <button
                v-bind="moreProps"
                type="button"
                class="mb-chip-filter"
                :class="{ 'mb-chip-filter--selected': MORE_CATEGORIES.includes(category) }"
              >
                {{ MORE_CATEGORIES.includes(category) ? category : "More" }}
                <v-icon icon="$expand" size="14" />
              </button>
            </template>
            <v-list density="compact" class="py-1" width="180">
              <v-list-item v-for="name in MORE_CATEGORIES" :key="name" min-height="32" class="px-3" @click="category = name">
                <span class="mb-apps-modal__menu-text">{{ name }}</span>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>

        <div class="mb-apps-modal__scroll">
          <div v-if="!loaded" class="mb-apps-modal__skeleton" aria-hidden="true" />
          <section v-for="section in sections" :key="section.title" class="mb-apps-modal__section">
            <div class="mb-apps-modal__section-head">
              <h3>{{ section.title }}</h3>
              <button v-if="section.viewAll" type="button" class="mb-apps-modal__view-all" @click="category = section.title">View all</button>
            </div>
            <p v-if="!section.plugins.length" class="mb-apps-modal__empty">Nothing here yet.</p>
            <div class="mb-apps-modal__grid">
              <div v-for="plugin in section.plugins" :key="plugin.id" class="mb-app-row">
                <button type="button" class="mb-app-row__main" @click="openPlugin(plugin)">
                  <MercbotPluginLogo :plugin="plugin" />
                  <span class="mb-app-row__text">
                    <span class="mb-app-row__name">{{ plugin.name }} <span class="mb-badge" :title="BADGES[plugin.badge]">{{ plugin.badge }}</span></span>
                  </span>
                </button>
                <button
                  type="button"
                  class="mb-app-row__action"
                  :class="{ 'mb-app-row__action--added': plugin.installed, 'mb-app-row__action--soon': plugin.soon }"
                  :disabled="plugin.installed || plugin.wanted || busyId === plugin.id"
                  :title="plugin.soon ? 'Coming soon: Request tells us you want it' : ''"
                  @click="install(plugin)"
                >
                  <v-icon v-if="plugin.installed" icon="$check" size="14" />
                  {{ busyId === plugin.id ? busyLabel : actionLabel(plugin) }}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <!-- App detail -->
      <div v-else-if="page === 'detail' && current" class="mb-apps-modal__page mb-apps-modal__page--scroll">
        <button type="button" class="mb-apps-modal__step" @click="page = 'catalogue'">Connect apps</button>
        <div class="mb-detail__head">
          <MercbotPluginLogo :plugin="current" :size="56" />
          <div class="mb-detail__title">
            <h2>{{ current.name }} <span class="mb-badge" :title="BADGES[current.badge]">{{ current.badge }}</span> <v-icon icon="$link" size="16" class="mb-detail__glyph" /></h2>
            <a class="mb-detail__source" :href="`/api/plugins/${current.id}/source`" target="_blank" rel="noopener">
              View source <v-icon icon="$openInNew" size="12" />
            </a>
          </div>
          <button type="button" class="mb-detail__pill" @click="copyShareLink(current)">
            <v-icon icon="$link" size="16" /> Share
          </button>
          <button
            v-if="current.soon"
            type="button"
            class="mb-detail__pill"
            :class="{ 'mb-detail__pill--primary': !current.wanted, 'mb-detail__pill--soon': current.wanted }"
            :disabled="current.wanted || busyId === current.id"
            @click="install(current)"
          >
            {{ current.wanted ? "Requested" : "Request" }}
          </button>
          <button
            v-else
            type="button"
            class="mb-detail__pill"
            :class="{ 'mb-detail__pill--primary': !current.installed, 'mb-detail__pill--busy': busyId === current.id }"
            :disabled="busyId === current.id"
            @click="current.installed ? uninstall(current) : install(current)"
          >
            {{ busyId === current.id ? busyLabel : current.installed ? "Uninstall" : "Connect" }}
          </button>
        </div>
        <p class="mb-detail__description">{{ current.description }}</p>
        <p v-if="current.soon" class="mb-detail__soon">
          <strong>Coming soon.</strong> Mercbot's connection to {{ current.name }} is being prepared<template v-if="current.wanted">, and we've noted that you want it</template>. Meanwhile your bots can still use {{ current.name }}'s website in their browser: just ask them.
        </p>

        <!-- A coming-soon app has no sign-in yet, so no accounts to show or sign in to. -->
        <section v-if="!current.soon && (current.installed || current.accounts.length || (managesHome && signsIn(current)))" class="mb-detail__group">
          <h3>Accounts</h3>
          <div class="mb-detail__box">
            <div v-for="account in current.accounts" :key="account.id" class="mb-detail__row">
              <input
                v-if="renamingAccountId === account.id"
                v-model="accountName"
                class="mb-detail__account-input"
                aria-label="Account name"
                maxlength="80"
                autofocus
                @keydown.enter.prevent="commitAccountRename(account)"
                @keydown.esc.stop.prevent="renamingAccountId = ''"
                @blur="commitAccountRename(account)"
              >
              <button
                v-else
                type="button"
                class="mb-detail__account"
                :aria-label="`Rename ${accountTitle(account)}`"
                :disabled="!canChange(account)"
                @click="startAccountRename(account)"
              >
                <span class="mb-detail__account-text">
                  {{ accountTitle(account) }}
                  <span v-if="account.home" class="mb-detail__home">
                    <v-icon icon="$home" size="12" />Everyone in {{ homeName }}<template v-if="account.addedBy"> · added by {{ account.addedBy }}</template>
                  </span>
                </span>
                <v-icon v-if="canChange(account)" icon="$edit" size="12" />
              </button>
              <template v-if="removingAccount === account.id">
                <span class="mb-detail__needs-auth">{{ account.home ? "Remove it for everyone?" : "Remove this account?" }}</span>
                <button type="button" class="mb-detail__small-pill" @click="removingAccount = ''">Keep</button>
                <button type="button" class="mb-detail__small-pill mb-detail__small-pill--danger" @click="removeAccount(account)">Remove</button>
              </template>
              <template v-else-if="!canChange(account)">
                <span :class="account.status === 'connected' ? 'mb-detail__connected' : 'mb-detail__needs-auth'">
                  {{ account.status === "connected" ? "Connected" : account.status === "more-access" ? "Needs more access" : "Needs auth" }}
                </span>
              </template>
              <template v-else-if="working(account) && confirmingDisconnect === account.id">
                <span class="mb-detail__needs-auth">Disconnect this account?</span>
                <button type="button" class="mb-detail__small-pill" @click="confirmingDisconnect = ''">Keep</button>
                <button type="button" class="mb-detail__small-pill mb-detail__small-pill--danger" @click="disconnect(account)">Disconnect</button>
              </template>
              <template v-else-if="account.status === 'connected'">
                <span class="mb-detail__connected">Connected</span>
                <button type="button" class="mb-detail__small-pill" @click="confirmingDisconnect = account.id">Disconnect</button>
                <button v-if="account.home" type="button" class="mb-detail__small-pill" @click="removingAccount = account.id">Remove</button>
              </template>
              <template v-else-if="account.status === 'more-access'">
                <span class="mb-detail__needs-auth" title="Signed in before this app asked for more access; it works with what it has until signed in again">Needs more access</span>
                <button type="button" class="mb-detail__small-pill" @click="signIn(current, account)">Sign in again</button>
                <button type="button" class="mb-detail__small-pill" @click="confirmingDisconnect = account.id">Disconnect</button>
              </template>
              <template v-else>
                <span class="mb-detail__needs-auth">Needs auth</span>
                <button type="button" class="mb-detail__small-pill" @click="signIn(current, account)">{{ NEEDS[account.status] || "Sign in" }}</button>
                <button v-if="account.home || current.accounts.filter((entry) => !entry.home).length > 1" type="button" class="mb-detail__small-pill" @click="removingAccount = account.id">Remove</button>
              </template>
            </div>
            <form v-if="addingAccount" class="mb-detail__row mb-detail__new-account" @submit.prevent="authorizeNewAccount(current)">
              <input
                v-model="newAccountLabel"
                class="mb-detail__account-input"
                aria-label="Label for the new account"
                placeholder="Label, e.g. work or personal"
                maxlength="80"
                autofocus
                @keydown.esc.stop.prevent="addingAccount = false"
              >
              <div v-if="managesHome" class="mb-detail__whose" role="radiogroup" aria-label="Who the account is for">
                <button type="button" role="radio" :aria-checked="!forHome" :disabled="!current.installed" @click="forHome = false">Just me</button>
                <button type="button" role="radio" :aria-checked="forHome" @click="forHome = true">Everyone in {{ homeName }}</button>
              </div>
              <button type="submit" class="mb-detail__small-pill" :disabled="!newAccountLabel.trim()">Authorize</button>
              <button type="button" class="mb-detail__small-pill" @click="addingAccount = false">Cancel</button>
            </form>
            <button v-else-if="current.installed || managesHome" type="button" class="mb-detail__add-account" @click="startAddAccount(current)">
              {{ current.installed ? "+ Add another account" : `+ Add an account for everyone in ${homeName}` }}
            </button>
          </div>
          <form v-if="pasteSignIn && !current.soon && current.accounts.some((account) => account.status !== 'connected')" class="mb-detail__paste" @submit.prevent="finishSignIn">
            <label for="mb-paste-address">Signing in didn't come back here? Paste the whole address the sign-in tab ended on.</label>
            <div class="mb-detail__paste-row">
              <input id="mb-paste-address" v-model="pastedAddress" placeholder="http://…/api/connections/callback?…" autocomplete="off" spellcheck="false">
              <button type="submit" class="mb-detail__small-pill" :disabled="finishing || !pastedAddress.trim()">{{ finishing ? "Finishing…" : "Finish" }}</button>
            </div>
            <span v-if="pasteProblem" class="mb-detail__paste-problem" role="alert">{{ pasteProblem }}</span>
          </form>
        </section>

        <section v-if="current.actions?.length && current.accounts.some(working)" class="mb-detail__group">
          <h3>Tools</h3>
          <div class="mb-detail__box">
            <button type="button" class="mb-detail__row mb-tools__head" :aria-expanded="toolsOpen" @click="toolsOpen = !toolsOpen">
              <span>{{ enabledCount(current) }} of {{ current.actions.length }} enabled</span>
              <v-icon :icon="toolsOpen ? '$collapse' : '$expand'" size="18" />
            </button>
            <div v-if="toolsOpen" class="mb-tools__list">
              <div v-for="action in current.actions" :key="action.id" class="mb-tools__row">
                <span>{{ action.name }}</span>
                <button
                  type="button"
                  role="switch"
                  class="mb-tools__switch"
                  :class="{ 'mb-tools__switch--on': action.enabled }"
                  :aria-checked="action.enabled"
                  :aria-label="action.name"
                  @click="setAction(current, action)"
                >
                  <span class="mb-tools__knob" />
                </button>
              </div>
            </div>
          </div>
        </section>

        <section v-if="current.connectors.length" class="mb-detail__group">
          <h3>Apps {{ current.connectors.length }}</h3>
          <div class="mb-detail__box">
            <div v-for="connector in current.connectors" :key="connector" class="mb-detail__row mb-detail__row--item">
              <v-icon icon="$power" size="16" />
              <span><span class="mb-detail__item-name">{{ connector }}</span><span class="mb-detail__item-sub">Connector</span></span>
            </div>
          </div>
        </section>

        <section v-if="current.skills.length" class="mb-detail__group">
          <h3>Skills {{ current.skills.length }}</h3>
          <div class="mb-detail__box">
            <div v-for="entry in current.skills" :key="entry.name" class="mb-detail__row mb-detail__row--item">
              <v-icon icon="$deployedCode" size="16" />
              <span><span class="mb-detail__item-name mb-detail__item-name--mono">{{ entry.name }}</span><span class="mb-detail__item-sub">{{ entry.description }}</span></span>
            </div>
          </div>
        </section>

        <section class="mb-detail__group">
          <h3>Information</h3>
          <div class="mb-detail__box">
            <div class="mb-detail__info"><span>Capabilities</span><span>{{ current.info.capabilities }}</span></div>
            <div class="mb-detail__info"><span>Developer</span><span>{{ current.info.developer }}</span></div>
            <div class="mb-detail__info"><span>Category</span><span>{{ current.category }}</span></div>
            <div class="mb-detail__info"><span>Website</span><span>{{ current.info.website || "—" }}</span></div>
            <div class="mb-detail__info"><span>Availability</span><span>{{ availability(current) }}</span></div>
          </div>
        </section>
      </div>

      <!-- Manage -->
      <div v-else-if="page === 'manage'" class="mb-apps-modal__page mb-apps-modal__page--scroll">
        <button type="button" class="mb-apps-modal__step" @click="page = 'catalogue'">Connect apps</button>
        <h2 class="mb-apps-modal__title mb-apps-modal__title--manage">Your apps and skills</h2>
        <section class="mb-detail__group">
          <h3>Installed</h3>
          <p v-if="!installed.length" class="mb-apps-modal__empty">No apps added yet.</p>
          <div class="mb-apps-modal__grid">
            <div v-for="plugin in shownInstalled" :key="plugin.id" class="mb-app-row">
              <button type="button" class="mb-app-row__main" @click="openPlugin(plugin)">
                <MercbotPluginLogo :plugin="plugin" />
                <span class="mb-app-row__text">
                  <span class="mb-app-row__name">{{ plugin.name }}</span>
                  <span class="mb-app-row__description">{{ parts(plugin) }}</span>
                </span>
              </button>
              <span v-if="worstState(plugin) === 'connected'" class="mb-detail__connected">Connected</span>
              <button
                v-else
                type="button"
                class="mb-app-row__action"
                @click="signIn(plugin, plugin.accounts.find((account) => account.status === worstState(plugin)))"
              >
                {{ NEEDS[worstState(plugin)] }}
              </button>
            </div>
          </div>
          <button v-if="installed.length > OVERVIEW_LIMIT && !showAllInstalled" type="button" class="mb-apps-modal__show-all" @click="showAllInstalled = true">
            Show all {{ installed.length }} plugins
          </button>
        </section>
        <section class="mb-detail__group">
          <h3>Private skills</h3>
          <p v-if="!skills.length" class="mb-apps-modal__empty">Skills your bots learn will show up here.</p>
          <div class="mb-apps-modal__grid">
            <button v-for="entry in skills" :key="entry.id" type="button" class="mb-app-row mb-app-row__main" @click="openSkill(entry)">
              <span class="mb-skill-icon"><v-icon icon="$description" size="20" /></span>
              <span class="mb-app-row__text">
                <span class="mb-app-row__name">{{ entry.name }}</span>
                <span class="mb-app-row__description">Made by your bots · {{ entry.description }}</span>
              </span>
            </button>
          </div>
        </section>
      </div>

      <!-- Private skill -->
      <div v-else-if="page === 'skill' && skill" class="mb-apps-modal__page mb-apps-modal__page--scroll">
        <button type="button" class="mb-apps-modal__step" @click="page = 'manage'">Your apps and skills</button>
        <div class="mb-detail__head">
          <span class="mb-skill-icon mb-skill-icon--large"><v-icon icon="$description" size="28" /></span>
          <div class="mb-detail__title">
            <h2>{{ skill.name }}</h2>
            <span class="mb-detail__source">Private skill</span>
          </div>
          <v-menu location="bottom end" :offset="4" content-class="mb-popover">
            <template #activator="{ props: publishProps }">
              <button v-bind="publishProps" type="button" class="mb-detail__pill mb-detail__pill--outline">
                Publish <v-icon icon="$expand" size="14" />
              </button>
            </template>
            <v-list density="compact" class="py-1" width="220">
              <v-list-item min-height="32" class="px-3" disabled>
                <span class="mb-apps-modal__menu-text">Sharing skills is coming later</span>
              </v-list-item>
            </v-list>
          </v-menu>
          <button type="button" class="mb-detail__pill mb-detail__pill--danger" @click="deleteSkill">
            {{ confirmingDelete ? "Delete for good?" : "Delete skill" }}
          </button>
        </div>
        <label class="mb-field">
          <span>Name</span>
          <input v-model="skillDraft.name" maxlength="80">
        </label>
        <label class="mb-field">
          <span>Description</span>
          <input v-model="skillDraft.description" maxlength="240">
        </label>
        <label class="mb-field">
          <span>Instructions</span>
          <textarea v-model="skillDraft.instructions" rows="10" />
        </label>
        <div class="mb-skill-foot">
          <button type="button" class="mb-detail__pill mb-detail__pill--primary" :disabled="!skillChanged" @click="saveSkill">Save</button>
        </div>
      </div>

      <Transition name="mb-toast">
        <div v-if="toast" class="mb-apps-toast" role="status">
          <v-icon icon="$checkCircleFilled" size="16" class="mb-apps-toast__icon" />
          <span class="mb-apps-toast__text">{{ toast }}</span>
          <button type="button" class="mb-apps-toast__close" aria-label="Dismiss" @click="toast = ''">
            <v-icon icon="$close" size="14" />
          </button>
        </div>
      </Transition>
    </div>
  </v-dialog>
</template>

<style scoped src="./MercbotAppsModal.css"></style>
<style scoped src="./MercbotAppsModalDetail.css"></style>
