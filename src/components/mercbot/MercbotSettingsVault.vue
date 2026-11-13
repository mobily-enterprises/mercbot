<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { vaultProblem } from "@local/account/shared/vault";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotVaultImport from "./MercbotVaultImport.vue";
import MercbotVaultPhoto from "./MercbotVaultPhoto.vue";
import { accountApi } from "./accountApi.js";

// Settings → Vault (D-17): logins the bots can sign in with, and cards and contact info kept for the person. The
// server encrypts passwords, card numbers and codes; the list only shows what identifies an item. Items are added one at a
// time, or from a CSV file (MercbotVaultImport); contact info can be read from a photo (MercbotVaultPhoto).
const create = defineModel("create", { type: String, default: "" });
const emit = defineEmits(["failure"]);

const items = ref([]);
const tab = ref("all");
const query = ref("");
const TABS = [
  { value: "all", title: "All" },
  { value: "login", title: "Logins" },
  { value: "card", title: "Cards" },
  { value: "contact", title: "Contact info" }
];

async function load() {
  try {
    items.value = (await accountApi.vault()).items;
  } catch (error) {
    emit("failure", error);
  }
}
onMounted(load);

const count = (kind) => (kind === "all" ? items.value.length : items.value.filter((item) => item.kind === kind).length);
function summary(item) {
  if (item.kind === "login") return item.data.username || "Login";
  if (item.kind === "card") return [`${item.data.brand} •••• ${item.data.last4}`, `expires ${item.data.expiry}`, item.data.name].filter(Boolean).join(" · ");
  return [item.data.fullName, item.data.address, item.data.city, item.data.email, item.data.phone].filter(Boolean).join(" · ");
}
const shown = computed(() => {
  const text = query.value.trim().toLowerCase();
  return items.value
    .filter((item) => tab.value === "all" || item.kind === tab.value)
    .filter((item) => !text || `${item.label} ${summary(item)}`.toLowerCase().includes(text));
});

// Deleting asks first, like Reset and Sign out.
const pendingDelete = ref(null);

async function remove(item) {
  items.value = items.value.filter((entry) => entry.id !== item.id);
  try {
    await accountApi.deleteVaultItem(item.id);
  } catch (error) {
    emit("failure", error);
    load();
  }
}

// The three item dialogs. Each saves only when its required fields are filled in.
const dialog = ref("");
const error = ref("");
const saving = ref(false);
const login = ref({});
const card = ref({});
const contact = ref({});
const showCode = ref(false);
const billing = ref(false);
const fromPhoto = ref(false);
const importing = ref(false);

watch(create, (kind) => {
  if (!kind) return;
  create.value = "";
  if (kind === "import") {
    importing.value = true;
    return;
  }
  error.value = "";
  login.value = { website: "", username: "", password: "", notes: "" };
  card.value = { number: "", expiry: "", code: "", name: "", nickname: "", billing: "" };
  contact.value = { label: "", fullName: "", address: "", address2: "", city: "", region: "", postalCode: "", country: "", phone: "", email: "" };
  showCode.value = false;
  billing.value = false;
  fromPhoto.value = false;
  dialog.value = kind;
});

// What a photo showed fills the contact form; the person checks it before saving.
function fillContact(fields) {
  Object.assign(contact.value, fields);
  fromPhoto.value = true;
}

const formData = () => ({ login: login.value, card: card.value, contact: contact.value })[dialog.value];
// The same rules the server checks.
const valid = computed(() => Boolean(dialog.value) && !vaultProblem(dialog.value, formData()));

async function save() {
  if (!valid.value) return;
  saving.value = true;
  error.value = "";
  try {
    const data = formData();
    const { item } = await accountApi.addVaultItem({ kind: dialog.value, data });
    items.value = [item, ...items.value];
    dialog.value = "";
  } catch (failure) {
    error.value = failure?.message || "That couldn't be saved. Try again.";
  } finally {
    saving.value = false;
  }
}

const COUNTRIES = ["Australia", "Austria", "Belgium", "Brazil", "Canada", "Denmark", "Finland", "France", "Germany", "Greece", "India", "Ireland", "Italy", "Japan", "Mexico", "Netherlands", "New Zealand", "Norway", "Poland", "Portugal", "Singapore", "South Africa", "Spain", "Sweden", "Switzerland", "United Kingdom", "United States"];
// A country read from a photo that the list doesn't name is offered too, so the form shows what was read.
const countries = computed(() => (contact.value.country && !COUNTRIES.includes(contact.value.country) ? [...COUNTRIES, contact.value.country].sort() : COUNTRIES));
const TITLES = { login: "New login", card: "New card", contact: "New contact info" };
</script>

<template>
  <section>
    <div class="mb-vault__bar">
      <div class="mb-vault__tabs" role="tablist" aria-label="Vault items">
        <button
          v-for="entry in TABS"
          :key="entry.value"
          type="button"
          role="tab"
          class="mb-vault__tab"
          :class="{ 'mb-vault__tab--selected': tab === entry.value }"
          :aria-selected="tab === entry.value"
          @click="tab = entry.value"
        >
          {{ entry.title }} <span class="mb-vault__count">{{ count(entry.value) }}</span>
        </button>
      </div>
      <label class="mb-vault__search">
        <v-icon icon="$search" size="14" />
        <input v-model="query" aria-label="Search the vault" placeholder="Search">
      </label>
    </div>

    <ul v-if="shown.length" class="mb-set-card mb-vault__list">
      <li v-for="item in shown" :key="item.id" class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">{{ item.label }}</span>
          <span class="mb-set-row__description">{{ summary(item) }}</span>
        </span>
        <button type="button" class="mb-vault__delete" :aria-label="`Delete ${item.label}`" @click="pendingDelete = item">
          <v-icon icon="$delete" size="16" />
        </button>
      </li>
    </ul>
    <div v-else class="mb-vault__empty">
      <p>{{ items.length ? "Nothing matches." : "Nothing saved yet. Use New item to add a login, a card or contact info." }}</p>
    </div>
    <p class="mb-vault__footnote">Your bots never see your passwords or a card's number or security code. They can use a saved login to sign in for you, seeing only its username. Cards and contact info are kept here for you; bots don't use them yet.</p>

    <MercbotConfirmDialog
      :model-value="Boolean(pendingDelete)"
      :title="`Delete ${pendingDelete?.label}?`"
      text="It's removed from your vault, and your bots can't use it any more."
      dim
      @update:model-value="pendingDelete = null"
      @confirm="remove(pendingDelete)"
    />

    <MercbotVaultImport v-model="importing" @imported="load" />

    <v-dialog :model-value="Boolean(dialog)" :width="dialog === 'contact' ? 520 : 420" scrim="scrim" :opacity="0.5" @update:model-value="dialog = ''">
      <form v-if="dialog" class="mb-item" @submit.prevent="save">
        <div class="mb-item__head">
          <p class="mb-item__title">{{ TITLES[dialog] }}</p>
          <button type="button" class="mb-item__close" aria-label="Close" @click="dialog = ''"><v-icon icon="$close" size="16" /></button>
        </div>

        <template v-if="dialog === 'login'">
          <label class="mb-item__field"><span class="mb-item__name">Website</span>
            <span class="mb-item__input"><v-icon icon="$key" size="14" /><input v-model="login.website" placeholder="example.com" required></span>
          </label>
          <label class="mb-item__field"><span class="mb-item__name">Username or email <span class="mb-item__optional">(optional)</span></span><input v-model="login.username" class="mb-item__plain"></label>
          <label class="mb-item__field"><span class="mb-item__name">Password</span><input v-model="login.password" class="mb-item__plain" type="password" autocomplete="new-password" required></label>
          <label class="mb-item__field"><span class="mb-item__name">Notes <span class="mb-item__optional">(optional)</span></span><textarea v-model="login.notes" class="mb-item__plain" rows="2" /></label>
          <p class="mb-item__note">Your bots can use this login to sign in for you.</p>
        </template>

        <template v-else-if="dialog === 'card'">
          <div class="mb-item__pair">
            <button type="button" class="mb-set-pill" disabled title="Cards aren't read from photos: a card's number never goes to an AI"><v-icon icon="$photoCameraFilled" size="14" /> Scan with camera</button>
            <button type="button" class="mb-set-pill" disabled title="Cards aren't read from photos: a card's number never goes to an AI"><v-icon icon="$image" size="14" /> Upload a photo</button>
          </div>
          <p class="mb-item__or"><span>or enter it</span></p>
          <label class="mb-item__field"><span class="mb-item__name">Card number</span><input v-model="card.number" class="mb-item__plain" inputmode="numeric" autocomplete="cc-number"></label>
          <div class="mb-item__pair">
            <label class="mb-item__field"><span class="mb-item__name">Expiry</span><input v-model="card.expiry" class="mb-item__plain" placeholder="MM/YY" autocomplete="cc-exp"></label>
            <label class="mb-item__field"><span class="mb-item__name">Security code <span class="mb-item__optional">(optional)</span></span>
              <span class="mb-item__input">
                <input v-model="card.code" :type="showCode ? 'text' : 'password'" inputmode="numeric" autocomplete="cc-csc">
                <button type="button" class="mb-item__eye" :aria-label="showCode ? 'Hide the code' : 'Show the code'" @click="showCode = !showCode"><v-icon :icon="showCode ? '$visibilityOff' : '$visibility'" size="14" /></button>
              </span>
            </label>
          </div>
          <div class="mb-item__pair">
            <label class="mb-item__field"><span class="mb-item__name">Name on card <span class="mb-item__optional">(optional)</span></span><input v-model="card.name" class="mb-item__plain" autocomplete="cc-name"></label>
            <label class="mb-item__field"><span class="mb-item__name">Nickname <span class="mb-item__optional">(optional)</span></span><input v-model="card.nickname" class="mb-item__plain"></label>
          </div>
          <button v-if="!billing" type="button" class="mb-item__link" @click="billing = true">+ Add a billing address <span class="mb-item__optional">(optional)</span></button>
          <label v-else class="mb-item__field">Billing address <span class="mb-item__optional">(optional)</span><textarea v-model="card.billing" class="mb-item__plain" rows="2" /></label>
          <p class="mb-item__note">Your bots never see the card number.</p>
        </template>

        <template v-else>
          <MercbotVaultPhoto @read="fillContact" />
          <p class="mb-item__or"><span>or enter it</span></p>
          <p v-if="fromPhoto" class="mb-item__note" role="status">Filled in from the photo. Check each detail before saving.</p>
          <div class="mb-item__pair">
            <label class="mb-item__field"><span class="mb-item__name">Label <span class="mb-item__optional">(optional)</span></span><input v-model="contact.label" class="mb-item__plain" placeholder="Home"></label>
            <label class="mb-item__field"><span class="mb-item__name">Full name</span><input v-model="contact.fullName" class="mb-item__plain" autocomplete="name"></label>
          </div>
          <label class="mb-item__field"><span class="mb-item__name">Address</span><input v-model="contact.address" class="mb-item__plain" autocomplete="address-line1"></label>
          <label class="mb-item__field"><span class="mb-item__name">Address line 2 <span class="mb-item__optional">(optional)</span></span><input v-model="contact.address2" class="mb-item__plain" autocomplete="address-line2"></label>
          <div class="mb-item__pair">
            <label class="mb-item__field"><span class="mb-item__name">City</span><input v-model="contact.city" class="mb-item__plain" autocomplete="address-level2"></label>
            <label class="mb-item__field"><span class="mb-item__name">State or region <span class="mb-item__optional">(optional)</span></span><input v-model="contact.region" class="mb-item__plain" autocomplete="address-level1"></label>
          </div>
          <div class="mb-item__pair">
            <label class="mb-item__field"><span class="mb-item__name">Postal code</span><input v-model="contact.postalCode" class="mb-item__plain" autocomplete="postal-code"></label>
            <label class="mb-item__field"><span class="mb-item__name">Country</span>
              <select v-model="contact.country" class="mb-item__plain">
                <option value="">Choose…</option>
                <option v-for="country in countries" :key="country" :value="country">{{ country }}</option>
              </select>
            </label>
          </div>
          <div class="mb-item__pair">
            <label class="mb-item__field"><span class="mb-item__name">Phone <span class="mb-item__optional">(optional)</span></span><input v-model="contact.phone" class="mb-item__plain" type="tel" autocomplete="tel"></label>
            <label class="mb-item__field"><span class="mb-item__name">Email <span class="mb-item__optional">(optional)</span></span><input v-model="contact.email" class="mb-item__plain" type="email" autocomplete="email"></label>
          </div>
        </template>

        <p v-if="error" class="mb-item__error" role="alert">{{ error }}</p>
        <div class="mb-item__actions">
          <button v-if="dialog === 'contact'" type="button" class="mb-set-pill" @click="dialog = ''">Cancel</button>
          <button type="submit" class="mb-set-pill mb-set-pill--dark" :disabled="!valid || saving">{{ saving ? "Saving…" : "Save" }}</button>
        </div>
      </form>
    </v-dialog>
  </section>
</template>

<style scoped>
.mb-vault__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  max-width: 636px;
  margin-bottom: 16px;
}

.mb-vault__tabs {
  display: flex;
  gap: 4px;
}

.mb-vault__tab {
  height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: inherit;
  cursor: pointer;
}

.mb-vault__tab--selected {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-vault__count {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-vault__search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 180px;
  height: 30px;
  padding: 0 12px;
  border-radius: 15px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-vault__search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  outline: none;
}

.mb-vault__list {
  padding: 0;
  list-style: none;
}

.mb-vault__delete {
  display: inline-flex;
  padding: 6px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-vault__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  max-width: 636px;
  min-height: 160px;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-align: center;
}

.mb-vault__footnote {
  max-width: 636px;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-align: center;
}

.mb-item {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px 20px 20px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-item__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mb-item__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.mb-item__close,
.mb-item__eye {
  display: inline-flex;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-item__field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 13px;
}

.mb-item__name {
  white-space: nowrap;
}

.mb-item__optional {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-item__plain,
.mb-item__input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: inherit;
  outline: none;
}

textarea.mb-item__plain {
  height: auto;
  padding: 8px 10px;
  resize: vertical;
}

.mb-item__input {
  display: flex;
  align-items: center;
  gap: 6px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-item__input input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface));
  outline: none;
}

.mb-item__pair {
  display: flex;
  gap: 10px;
}

.mb-item__or {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-item__or::before,
.mb-item__or::after {
  content: "";
  flex: 1;
  height: 1px;
  background: rgb(var(--v-theme-outline-variant));
}

.mb-item__link {
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-link));
  cursor: pointer;
}

.mb-item__note {
  margin: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-item__error {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-error));
}

.mb-item__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
