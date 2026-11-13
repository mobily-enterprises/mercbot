<script setup>
import { computed, ref } from "vue";

// The secure form: what the person types here goes straight into the bot's page on
// that site, and optionally into their vault; the bot never sees it. Closing it means no.
const props = defineProps({
  site: { type: String, required: true },
  form: { type: String, default: "login" }
});
const emit = defineEmits(["submit", "close"]);
const open = defineModel({ type: Boolean, default: false });

const username = ref("");
const password = ref("");
const code = ref("");
const reveal = ref(false);
const save = ref(true);
const ready = computed(() => (props.form === "code" ? code.value.trim() : password.value && username.value.trim()));

function submit() {
  if (!ready.value) return;
  emit("submit", props.form === "code"
    ? { code: code.value.trim() }
    : { username: username.value.trim(), password: password.value, save: save.value });
  open.value = false;
}

function close() {
  open.value = false;
  emit("close");
}
</script>

<template>
  <v-dialog :model-value="open" max-width="420" @update:model-value="(value) => !value && close()">
    <form class="mb-secure" @submit.prevent="submit">
      <p class="mb-secure__title"><v-icon icon="$key" size="18" />{{ form === "code" ? `Code for ${site}` : `Sign in to ${site}` }}</p>
      <template v-if="form === 'code'">
        <label class="mb-secure__field">Code<input v-model="code" autocomplete="one-time-code" inputmode="numeric" autofocus></label>
      </template>
      <template v-else>
        <label class="mb-secure__field">Username or email<input v-model="username" autocomplete="username" autofocus></label>
        <label class="mb-secure__field">Password
          <span class="mb-secure__password">
            <input v-model="password" :type="reveal ? 'text' : 'password'" autocomplete="current-password">
            <button type="button" class="mb-secure__eye" :aria-label="reveal ? 'Hide password' : 'Show password'" @click="reveal = !reveal">
              <v-icon :icon="reveal ? '$visibilityOff' : '$visibility'" size="16" />
            </button>
          </span>
        </label>
        <label class="mb-secure__check"><input v-model="save" type="checkbox"> Save securely to your vault</label>
      </template>
      <p class="mb-secure__note">Your bot never sees this. It's only filled in on {{ site }}.</p>
      <div class="mb-secure__actions">
        <button type="button" class="mb-set-pill" @click="close">Close</button>
        <button type="submit" class="mb-set-pill mb-set-pill--dark" :disabled="!ready">Submit</button>
      </div>
    </form>
  </v-dialog>
</template>

<style scoped>
.mb-secure {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
}

.mb-secure__title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.mb-secure__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
}

.mb-secure__field input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface));
}

.mb-secure__password {
  position: relative;
  display: block;
}

.mb-secure__password input {
  padding-right: 36px;
}

.mb-secure__eye {
  position: absolute;
  top: 5px;
  right: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-secure__check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.mb-secure__note {
  margin: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-secure__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
