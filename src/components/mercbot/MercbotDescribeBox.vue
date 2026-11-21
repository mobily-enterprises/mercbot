<script setup>
import { computed, ref } from "vue";

// Add bots' "Describe what you need" (D-109): a sentence or two, and Suggest bots asks Mercbot for a plan, which the
// review shows before anything is added. A home with bots besides its main one is asked what's missing. A question
// the plan asked instead is shown above the box, for the person to add to what they wrote and suggest again.
const props = defineProps({
  // Whether the home has bots besides its main one.
  more: { type: Boolean, default: false },
  busy: { type: Boolean, default: false },
  question: { type: String, default: "" },
  failure: { type: String, default: "" }
});
const words = defineModel({ type: String, default: "" });
const emit = defineEmits(["suggest"]);
const box = ref(null);

const placeholder = computed(() => (props.more ? "What's missing? For example, help with payroll" : "For example, I run a dog-grooming salon with two staff"));
const canSuggest = computed(() => Boolean(words.value.trim()) && words.value.length <= 600 && !props.busy);

function suggest() {
  if (canSuggest.value) emit("suggest", words.value.trim());
}

defineExpose({ focus: () => box.value?.focus() });
</script>

<template>
  <form class="mb-describe" @submit.prevent="suggest">
    <label class="mb-describe__label" for="mb-describe-words">Describe what you need</label>
    <p v-if="question" class="mb-describe__question" role="status">{{ question }}</p>
    <textarea
      id="mb-describe-words"
      ref="box"
      v-model="words"
      class="mb-describe__box"
      rows="3"
      maxlength="600"
      :placeholder="placeholder"
      :disabled="busy"
      @keydown.enter.exact.prevent="suggest"
    />
    <div class="mb-describe__foot">
      <span class="mb-describe__hint">Mercbot picks bots from its library and writes new ones where nothing fits. You check them before any is added.</span>
      <button type="submit" class="mb-describe__go" :disabled="!canSuggest">{{ busy ? "Suggesting…" : "Suggest bots" }}</button>
    </div>
    <p v-if="failure" class="mb-describe__failure" role="alert">{{ failure }}</p>
  </form>
</template>

<style scoped>
.mb-describe {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mb-describe__label {
  font-size: 15px;
  font-weight: 600;
}

.mb-describe__question {
  margin: 0;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 13px;
  line-height: 18px;
}

.mb-describe__box {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 20px;
  color: inherit;
  resize: vertical;
}

.mb-describe__box:focus-visible {
  border-color: rgb(var(--v-theme-primary));
  outline: none;
}

.mb-describe__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}

.mb-describe__hint {
  flex: 1 1 240px;
  font-size: 12px;
  line-height: 16px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-describe__go {
  margin-left: auto;
  padding: 8px 16px;
  border: 0;
  border-radius: 18px;
  background: rgb(var(--v-theme-primary));
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-primary));
  cursor: pointer;
}

.mb-describe__go:disabled {
  opacity: 0.5;
  cursor: default;
}

.mb-describe__failure {
  margin: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-error));
}
</style>
