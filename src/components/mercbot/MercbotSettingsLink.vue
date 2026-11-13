<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { bridgeApi } from "./pluginsApi.js";

// Settings → Mercbot account (D-31): link this copy to an account on another Mercbot that connects accounts for it (the
// hub, MERCBOT_HUB_URL), so it can connect Google, Microsoft and GitHub through the hub's apps. The person who linked
// this copy unlinks it, and so can the owners and admins of a home they're in.
const emit = defineEmits(["failure", "notify"]);
const status = ref(null);
const name = ref("My Mercbot");
const code = ref("");
const busy = ref(false);
const problem = ref("");
// Unlinking signs out, in every home, every account that connected through the hub.
const confirming = ref(false);
let poll = null;

const hubName = () => String(status.value?.hubUrl || "").replace(/^https?:\/\//u, "");

async function load() {
  try {
    status.value = await bridgeApi.status();
  } catch (error) {
    emit("failure", error);
  }
}

// While the person approves on the hub, check every few seconds for up to 15 minutes.
function waitForApproval() {
  clearInterval(poll);
  const started = Date.now();
  poll = setInterval(async () => {
    if (Date.now() - started > 15 * 60000) {
      clearInterval(poll);
      return;
    }
    try {
      status.value = await bridgeApi.check();
      if (status.value.linked) {
        clearInterval(poll);
        code.value = "";
        emit("notify", "This copy is now linked");
      }
    } catch (error) {
      clearInterval(poll);
      problem.value = error?.message || "The link didn't go through. Try again.";
    }
  }, 3000);
}

async function link() {
  busy.value = true;
  problem.value = "";
  const tab = window.open("", "_blank");
  try {
    const request = await bridgeApi.link(name.value);
    code.value = request.code;
    if (tab) tab.location.href = request.approveUrl;
    status.value = { ...status.value, pending: true };
    waitForApproval();
  } catch (error) {
    tab?.close();
    problem.value = error?.message || "The link didn't start. Try again.";
  } finally {
    busy.value = false;
  }
}

async function unlink() {
  busy.value = true;
  problem.value = "";
  try {
    status.value = await bridgeApi.unlink();
    confirming.value = false;
    emit("notify", "This copy is no longer linked");
  } catch (error) {
    problem.value = error?.message || "That didn't work. Try again.";
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await load();
  if (status.value?.pending) waitForApproval();
});
onBeforeUnmount(() => clearInterval(poll));
</script>

<template>
  <section v-if="status">
    <p class="mb-set-group">This copy of Mercbot</p>
    <div class="mb-set-card">
      <div v-if="status.linked" class="mb-set-row" :class="{ 'mb-link-set__confirming': confirming }">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Linked to {{ hubName() }} as “{{ status.name }}”</span>
          <span class="mb-set-row__description">Connecting Google, Microsoft or GitHub goes through your account there. Your mail, calendar and files still travel straight between this copy and them.</span>
          <span v-if="!status.canUnlink" class="mb-set-row__description">The person who linked this copy can unlink it, and so can the owners and admins of a home they're in.</span>
        </span>
        <template v-if="status.canUnlink">
          <template v-if="confirming">
            <span class="mb-link-set__confirm">Sign out every account connected through {{ hubName() }}?</span>
            <button type="button" class="mb-set-pill" :disabled="busy" @click="confirming = false">Keep</button>
            <button type="button" class="mb-set-pill mb-set-pill--dark" :disabled="busy" @click="unlink">Unlink</button>
          </template>
          <button v-else type="button" class="mb-set-pill" :disabled="busy" @click="confirming = true">Unlink</button>
        </template>
      </div>
      <div v-else-if="!status.hubUrl" class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Not linked</span>
          <span class="mb-set-row__description">No Mercbot to link to is set up for this copy (MERCBOT_HUB_URL). Connect Google, Microsoft and GitHub with this copy's own apps instead.</span>
        </span>
      </div>
      <template v-else>
        <div class="mb-set-row">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">Not linked</span>
            <span class="mb-set-row__description">Link this copy to your account on {{ hubName() }} to connect Google, Microsoft and GitHub with one click, without registering any apps yourself.</span>
          </span>
        </div>
        <div class="mb-set-row mb-link-set__form">
          <label class="mb-link-set__field">
            <span>Name for this copy</span>
            <input v-model="name" maxlength="80" placeholder="My Mercbot">
          </label>
          <button type="button" class="mb-set-pill mb-set-pill--dark" :disabled="busy" @click="link">
            {{ status.pending ? "Start again" : "Link" }}
          </button>
        </div>
        <p v-if="status.pending" class="mb-set-row mb-link-set__waiting">
          Approve the link in the tab that opened, signed in to your account on {{ hubName() }}.
          <template v-if="code"> Check that it shows the code <strong>{{ code }}</strong>.</template>
        </p>
      </template>
    </div>
    <p v-if="problem" class="mb-link-set__problem" role="alert">{{ problem }}</p>
  </section>
</template>

<style scoped>
.mb-link-set__form {
  align-items: flex-end;
  gap: 10px;
  padding-top: 12px;
  padding-bottom: 12px;
}

.mb-link-set__field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 13px;
}

.mb-link-set__field input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface));
}

.mb-link-set__waiting {
  margin: 0;
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

/* Asking before unlinking: the row's words keep their width, and the question and its buttons go on the line below. */
.mb-link-set__confirming {
  flex-wrap: wrap;
}

.mb-link-set__confirming .mb-set-row__text {
  flex-basis: 100%;
}

.mb-link-set__confirm {
  flex: auto;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-link-set__problem {
  margin: 10px 0 0;
  font-size: 13px;
  color: rgb(var(--v-theme-error));
}
</style>
