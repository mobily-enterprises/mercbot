<script setup>
import { computed, ref } from "vue";

// A message the bot wrote for the person to send as themselves: an
// editable card with From, In reply to, To and Cc, sent only by Send (or by telling the bot to).
// Once sent it folds into one row that opens again.
const props = defineProps({
  message: { type: Object, required: true },
  // In a group, whom the draft is waiting for when it isn't the person looking (D-46).
  waitingFor: { type: String, default: "" }
});
const emit = defineEmits(["settle", "manage-rules"]);
const body = props.message.body;
const subject = ref(body.subject || "");
const to = ref(body.to || "");
const cc = ref(body.cc || "");
const text = ref(body.text || "");
const pending = body.status === "pending" && !props.waitingFor;
const sending = ref(false);
const open = ref(false);
const isMail = Boolean(body.from || body.subject !== undefined || body.inReplyTo);
const sentText = computed(() => ({
  sent: `Sent email · ${body.to}`,
  send: `Sent on your OK · ${body.to}`,
  sending: `Sending · ${body.to}`
}[body.status] || ""));

function send() {
  if (!text.value.trim() || sending.value) return;
  sending.value = true;
  // If it doesn't go through, the card is ready to try again.
  emit("settle", {
    action: "send",
    text: text.value,
    to: to.value,
    cc: cc.value,
    ...(body.subject !== undefined ? { subject: subject.value } : {})
  }, () => { sending.value = false; });
}
</script>

<template>
  <section class="mb-draft" :class="{ 'mb-draft--folded': !pending && body.status !== 'discarded' }" :aria-label="`Draft to ${body.to}`">
    <p v-if="waitingFor && body.status === 'pending'" class="mb-draft__waiting">Waiting for {{ waitingFor }} to send or discard it</p>
    <template v-if="pending || body.status === 'discarded'">
      <p class="mb-draft__head"><v-icon icon="$mail" size="16" />{{ isMail ? "Mail" : "Message" }}<span v-if="body.status === 'discarded'" class="mb-draft__gone">· Discarded, not sent</span></p>
      <input v-if="pending && body.subject !== undefined" v-model="subject" class="mb-draft__subject" aria-label="Subject">
      <p v-else-if="body.subject" class="mb-draft__subject mb-draft__subject--read">{{ body.subject }}</p>
      <dl class="mb-draft__rows">
        <div v-if="body.from" class="mb-draft__row"><dt>From</dt><dd>{{ body.from }}</dd></div>
        <div v-if="body.inReplyTo" class="mb-draft__row"><dt>In reply to</dt><dd>“{{ body.inReplyTo.subject }}” · {{ body.inReplyTo.from }}</dd></div>
        <div class="mb-draft__row">
          <dt>To</dt>
          <dd><input v-if="pending" v-model="to" class="mb-draft__field" aria-label="To"><template v-else>{{ body.to }}</template></dd>
        </div>
        <div v-if="isMail" class="mb-draft__row">
          <dt>Cc</dt>
          <dd><input v-if="pending" v-model="cc" class="mb-draft__field" placeholder="name@example.com" aria-label="Cc"><template v-else>{{ body.cc }}</template></dd>
        </div>
        <div v-if="!body.from" class="mb-draft__row"><dt>Via</dt><dd>{{ body.via }}</dd></div>
      </dl>
      <textarea v-if="pending" v-model="text" class="mb-draft__text" rows="7" aria-label="Message" />
      <p v-else class="mb-draft__sent">{{ body.text }}</p>
      <div v-if="pending" class="mb-draft__actions">
        <v-menu location="top start">
          <template #activator="{ props: menu }">
            <button type="button" class="mb-draft__approval" v-bind="menu">Needs approval<v-icon icon="$expand" size="14" /></button>
          </template>
          <v-list density="compact" class="mb-draft__menu">
            <v-list-item title="Needs approval" disabled><template #append><v-icon icon="$check" size="16" /></template></v-list-item>
            <v-list-item title="Manage rules" @click="emit('manage-rules')" />
          </v-list>
        </v-menu>
        <span class="mb-draft__spacer" />
        <button type="button" class="mb-draft__discard" :disabled="sending" @click="emit('settle', { action: 'discard' })">Discard</button>
        <button type="button" class="mb-set-pill mb-set-pill--dark" :disabled="!text.trim() || sending" @click="send">
          <v-progress-circular v-if="sending" indeterminate size="14" width="2" />
          <template v-else>Send</template>
        </button>
      </div>
    </template>
    <template v-else>
      <button type="button" class="mb-draft__fold" :aria-expanded="open" @click="open = !open">
        <v-icon icon="$mail" size="16" />
        <span>{{ isMail ? "Mail" : "Message" }}</span>
        <span class="mb-draft__gone">{{ sentText }}</span>
        <v-icon :icon="open ? '$collapse' : '$expand'" size="16" class="mb-draft__chevron" />
      </button>
      <template v-if="open">
        <p v-if="body.subject" class="mb-draft__subject mb-draft__subject--read">{{ body.subject }}</p>
        <dl class="mb-draft__rows">
          <div v-if="body.from" class="mb-draft__row"><dt>From</dt><dd>{{ body.from }}</dd></div>
          <div class="mb-draft__row"><dt>To</dt><dd>{{ body.to }}</dd></div>
          <div v-if="body.cc" class="mb-draft__row"><dt>Cc</dt><dd>{{ body.cc }}</dd></div>
        </dl>
        <p class="mb-draft__sent">{{ body.text }}</p>
      </template>
    </template>
  </section>
</template>

<style scoped>
.mb-draft {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 460px;
  padding: 12px 14px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
}

.mb-draft--folded {
  padding: 8px 12px;
}

.mb-draft__head,
.mb-draft__fold {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-draft__fold {
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.mb-draft__gone {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-draft__chevron {
  margin-left: auto;
}

.mb-draft__subject {
  width: 100%;
  margin: 0;
  padding: 4px 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}

.mb-draft__rows {
  display: flex;
  flex-direction: column;
  margin: 0;
}

.mb-draft__row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding: 6px 0;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
  font-size: 13px;
}

.mb-draft__row:last-child {
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}

.mb-draft__row dt {
  flex: none;
  width: 76px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-draft__row dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

.mb-draft__field {
  width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: rgb(var(--v-theme-on-surface));
}

.mb-draft__field::placeholder {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-draft__text {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  color: rgb(var(--v-theme-on-surface));
  resize: vertical;
}

.mb-draft__waiting {
  margin: 0 0 6px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-draft__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mb-draft__spacer {
  flex: 1;
}

.mb-draft__approval,
.mb-draft__discard {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-draft__sent {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  white-space: pre-wrap;
}
</style>
