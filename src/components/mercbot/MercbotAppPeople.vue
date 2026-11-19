<script setup>
import { onMounted, ref, watch } from "vue";
import { pluginsApi } from "./pluginsApi.js";

// Who each of the home's people is at an app connected with the home's API credentials (D-93): the person's own (by
// their email address, or the user they pick, which an owner or admin confirms), and for owners and admins everyone's,
// with the picks waiting for them.
const props = defineProps({
  plugin: { type: Object, required: true },
  account: { type: Object, required: true },
  managesHome: { type: Boolean, default: false }
});
const me = ref(null);
const people = ref([]);
const words = ref("");
const found = ref(null);
const busy = ref(false);
const problem = ref("");

async function load() {
  problem.value = "";
  try {
    me.value = await pluginsApi.appPerson(props.account.id);
    if (props.managesHome) people.value = (await pluginsApi.appPeople(props.account.id)).people;
  } catch (error) {
    problem.value = error?.message || `Couldn't read who you are in ${props.plugin.name}.`;
  }
}
onMounted(load);
watch(() => props.account.label, load);

async function search() {
  if (words.value.trim().length < 2) return;
  busy.value = true;
  problem.value = "";
  try {
    found.value = (await pluginsApi.appUsers(props.account.id, words.value.trim())).users;
  } catch (error) {
    problem.value = error?.message || "That search didn't work.";
  } finally {
    busy.value = false;
  }
}

async function act(work) {
  busy.value = true;
  problem.value = "";
  try {
    await work();
    found.value = null;
    words.value = "";
    await load();
  } catch (error) {
    problem.value = error?.message || "That didn't work.";
  } finally {
    busy.value = false;
  }
}

const pick = (user) => act(() => pluginsApi.pickAppUser(props.account.id, user.id));
const confirm = (person) => act(() => pluginsApi.confirmAppPerson(props.account.id, person.id));
const forget = (userId) => act(() => pluginsApi.forgetAppPerson(props.account.id, userId));

/** How a person's row reads. */
function state(person) {
  if (person.via === "email") return `${person.appUser.name}, by email address`;
  if (person.via === "picked") return `${person.appUser.name}, picked and confirmed`;
  if (person.taken) return `${person.taken} by email, but confirmed for someone else`;
  if (person.asked) return `Asks to be ${person.asked.name}`;
  if (person.unchecked) return "Not checked yet";
  return `Not found in ${props.plugin.name}`;
}
</script>

<template>
  <section class="mb-people" :aria-label="`People in ${plugin.name}`">
    <h3>Who you are in {{ plugin.name }}</h3>
    <div class="mb-people__box">
      <p v-if="!me" class="mb-people__line">Checking…</p>
      <template v-else-if="me.person">
        <p class="mb-people__line">
          <strong>{{ me.person.name }}</strong><template v-if="me.via === 'email'">, by your email address</template><template v-else>, picked and confirmed</template>.
          Your bots read only your {{ plugin.name }} teams: {{ me.person.teams.map((team) => team.name).join(", ") || "none yet" }}.
        </p>
        <button v-if="me.via === 'picked'" type="button" class="mb-people__pill" :disabled="busy" @click="forget('me')">That's not me</button>
      </template>
      <template v-else-if="me.asked">
        <p class="mb-people__line">You picked <strong>{{ me.asked.name }}</strong>. An owner or admin of the home confirms it before your bots read {{ plugin.name }}.</p>
        <button type="button" class="mb-people__pill" :disabled="busy" @click="forget('me')">Cancel</button>
      </template>
      <template v-else>
        <p class="mb-people__line">
          <template v-if="me.taken">{{ plugin.name }}'s user with your email address, {{ me.taken }}, is confirmed for someone else: an owner or admin sorts it out.</template>
          <template v-else-if="me.gone">The {{ plugin.name }} user confirmed for you, {{ me.gone }}, is gone. Pick yourself again.</template>
          <template v-else>No {{ plugin.name }} user has your email address, so your bots read nothing there. Find yourself and pick; {{ managesHome ? "as an owner or admin, it's confirmed at once" : "an owner or admin confirms it" }}.</template>
        </p>
        <form v-if="!me.taken" class="mb-people__search" @submit.prevent="search">
          <input v-model="words" :aria-label="`Find yourself in ${plugin.name}`" placeholder="Your name or email" maxlength="100">
          <button type="submit" class="mb-people__pill" :disabled="busy || words.trim().length < 2">Find</button>
        </form>
        <ul v-if="found" class="mb-people__list">
          <li v-if="!found.length" class="mb-people__line">No one found.</li>
          <li v-for="user in found" :key="user.id" class="mb-people__row">
            <span>{{ user.name }}<span class="mb-people__sub">{{ user.email }}</span></span>
            <button type="button" class="mb-people__pill" :disabled="busy" @click="pick(user)">This is me</button>
          </li>
        </ul>
      </template>
      <span v-if="problem" class="mb-people__problem" role="alert">{{ problem }}</span>
    </div>

    <template v-if="managesHome && people.length">
      <h3>People</h3>
      <ul class="mb-people__box mb-people__list">
        <li v-for="person in people" :key="person.id" class="mb-people__row">
          <span>{{ person.name }}<span class="mb-people__sub">{{ state(person) }}</span></span>
          <template v-if="person.asked">
            <button type="button" class="mb-people__pill mb-people__pill--primary" :disabled="busy" @click="confirm(person)">Confirm</button>
            <button type="button" class="mb-people__pill" :disabled="busy" @click="forget(person.id)">Refuse</button>
          </template>
          <button v-else-if="person.via === 'picked'" type="button" class="mb-people__pill" :disabled="busy" @click="forget(person.id)">Undo</button>
        </li>
      </ul>
    </template>
  </section>
</template>

<style scoped src="./MercbotCredentials.css"></style>
