<script setup>
import { computed, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { useRouter } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { HOME_NAME_MAX, useHomes } from "./homesApi.js";
import { HOME_FOR, makeHome } from "./homeDefault.js";
import MercbotTeamScreen from "./MercbotTeamScreen.vue";
import { homeQuery, nameFor, newHomeLabel } from "./teamChoice.js";

// New home (D-36), from the home switcher: first what the home is for, as Mercbot's teams (D-105) on the same cards
// New bot's Add a team shows, and Something else last. A team shows its bots, all ticked, then the home's name, the
// team's to start with, and who it's for (D-100): Create home with N bots makes the home and goes there, where its
// first load adds the bots ticked (homeQuery; pages/w/[workspaceSlug]/index.vue). Something else asks only the name and
// who it's for, and the home starts with just Mercbot. On a phone it fills the screen.
const open = defineModel("open", { type: Boolean, default: false });

const paths = usePaths();
const router = useRouter();
const { create } = useHomes();
const display = useDisplay();
const phone = computed(() => display.width.value < 600);

// pick (the cards, or a team's bots) or other (Something else).
const step = ref("pick");
const team = ref("");
const shownTeam = ref(null);
const name = ref("");
const forWhom = ref(HOME_FOR[0].value);
const busy = ref(false);
const problem = ref("");
const teamScreen = ref(null);

watch(open, (value) => {
  if (!value) return;
  step.value = "pick";
  team.value = "";
  shownTeam.value = null;
  name.value = "";
  forWhom.value = HOME_FOR[0].value;
  problem.value = "";
});

// A team names the home after it while the name is empty or still the last team's: a name typed stays.
function showTeam(read) {
  name.value = nameFor(name.value, shownTeam.value, read);
  shownTeam.value = read;
}

function toOther() {
  name.value = nameFor(name.value, shownTeam.value, null);
  shownTeam.value = null;
  step.value = "other";
}

/** Enter in the name: the team screen's action, as its button does. */
function submitTeam() {
  teamScreen.value.add();
}

function close() {
  if (!busy.value) open.value = false;
}

/** Makes the home, then goes there: with the team's bots ticked, when one was chosen, to be added as it first loads. */
async function createHome(choice = null) {
  const wanted = name.value.trim();
  if (!wanted || busy.value) return;
  busy.value = true;
  problem.value = "";
  try {
    const home = await makeHome(create, wanted, forWhom.value);
    open.value = false;
    await router.push({ path: paths.page("/", { params: { workspaceSlug: home.slug } }), query: choice ? homeQuery(choice) : {} });
  } catch (error) {
    problem.value = error?.message || "That home couldn't be made. Try again.";
  } finally {
    busy.value = false;
  }
}

const otherReady = computed(() => Boolean(name.value.trim()) && !busy.value);
</script>

<template>
  <v-dialog :model-value="open" width="auto" :fullscreen="phone" :persistent="busy" @update:model-value="close">
    <div class="mb-ctemp" :class="{ 'mb-ctemp--phone': phone }" role="dialog" aria-label="New home">
      <div class="mb-ctemp__head">
        <h2 class="mb-ctemp__title">{{ step === "other" ? "Something else" : "What's this home for?" }}</h2>
        <button type="button" class="mb-ctemp__close" aria-label="Close" :disabled="busy" @click="close">
          <v-icon icon="$close" :size="phone ? 18 : 14" />
        </button>
      </div>

      <div class="mb-ctemp__body">
        <div v-if="step === 'pick'" class="mb-ctemp__step">
          <MercbotTeamScreen
            ref="teamScreen"
            v-model:team="team"
            fresh
            list-back=""
            :busy="busy"
            :error="problem"
            :ready="Boolean(name.trim())"
            :action-words="newHomeLabel"
            @shown="showTeam"
            @other="toOther"
            @back="close"
            @add="createHome"
          >
            <form class="mb-newhome__fields" @submit.prevent="submitTeam">
              <label class="mb-newhome__label" for="mb-newhome-name">Name your home</label>
              <input id="mb-newhome-name" v-model="name" class="mb-newhome__input" :maxlength="HOME_NAME_MAX" aria-label="Name of the new home">
              <fieldset class="mb-newhome__for">
                <legend class="mb-newhome__label">Who's it for?</legend>
                <label v-for="choice in HOME_FOR" :key="choice.value" class="mb-newhome__choice">
                  <input v-model="forWhom" type="radio" name="home-for" :value="choice.value">
                  {{ choice.label }}
                </label>
              </fieldset>
            </form>
          </MercbotTeamScreen>
        </div>

        <form v-else class="mb-ctemp__step" @submit.prevent="createHome()">
          <div class="mb-ctemp__scroll">
            <p class="mb-newhome__intro">Your home starts with just Mercbot. Add bots whenever you like.</p>
            <div class="mb-newhome__fields">
              <label class="mb-newhome__label" for="mb-newhome-other">Name your home</label>
              <input
                id="mb-newhome-other"
                v-model="name"
                class="mb-newhome__input"
                :maxlength="HOME_NAME_MAX"
                placeholder="For example, The Smiths"
                aria-label="Name of the new home"
              >
              <fieldset class="mb-newhome__for">
                <legend class="mb-newhome__label">Who's it for?</legend>
                <label v-for="choice in HOME_FOR" :key="choice.value" class="mb-newhome__choice">
                  <input v-model="forWhom" type="radio" name="home-for-other" :value="choice.value">
                  {{ choice.label }}
                </label>
              </fieldset>
            </div>
          </div>
          <p v-if="problem" class="mb-ctemp__error" role="alert">{{ problem }}</p>
          <div class="mb-ctemp__foot">
            <button type="button" class="mb-ctemp__button" :disabled="busy" @click="step = 'pick'">Back</button>
            <button type="submit" class="mb-ctemp__button mb-ctemp__button--primary" :disabled="!otherReady">
              {{ busy ? "Creating…" : "Create home" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped src="./MercbotChangeTemplateDialog.css"></style>
<style scoped>
.mb-newhome__intro {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-newhome__fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
}

.mb-newhome__label {
  padding: 0;
  font-size: 13px;
  font-weight: 600;
}

.mb-newhome__input {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 10px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 15px;
}

.mb-newhome__input:focus {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 0;
}

.mb-newhome__for {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 18px;
  margin: 6px 0 0;
  padding: 0;
  border: 0;
}

.mb-newhome__for .mb-newhome__label {
  width: 100%;
  margin-bottom: 2px;
}

.mb-newhome__choice {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-size: 14px;
  cursor: pointer;
}

.mb-newhome__choice input {
  margin: 0;
  accent-color: rgb(var(--v-theme-secondary));
}
</style>
