<script setup>
import { computed } from "vue";
import { fileUrl, formatSize } from "@/components/mercbot/filesApi.js";

// A record's file or picture field in a form (D-127): what it holds now (a picture as a thumbnail, a file as a link with
// its name and size), taken away with Remove, and a new one to choose, which the form uploads once the record is saved.
// The file itself lives in the home's Database files, at the record's own place.
const props = defineProps({
  field: { type: Object, required: true },
  // The stored value ({ path, name, size, type }), or null.
  current: { type: Object, default: null },
  // The file chosen to replace it, not uploaded yet.
  chosen: { type: Object, default: null },
  errorMessages: { type: String, default: "" }
});
const emit = defineEmits(["update:current", "update:chosen"]);
const picture = computed(() => props.field.type === "image");
const href = computed(() => (props.current?.path ? fileUrl(null, props.current.path, { download: !picture.value, chat: null }) : ""));
const label = computed(() => props.field.label + (props.field.options?.required ? " *" : ""));
</script>

<template>
  <div class="mb-4">
    <div v-if="current && !chosen" class="d-flex align-center ga-3 mb-2">
      <v-img v-if="picture" :src="href" :alt="current.name" width="72" height="72" cover rounded="lg" class="flex-grow-0 bg-surface-container-low" />
      <v-icon v-else icon="$attachFile" color="on-surface-variant" />
      <div class="flex-grow-1 text-body-2 text-truncate">
        <a :href="href" target="_blank" rel="noopener">{{ current.name }}</a>
        <div class="text-on-surface-variant">{{ field.label }} · {{ formatSize(current.size) }}</div>
      </div>
      <v-btn variant="text" size="small" @click="emit('update:current', null)">Remove</v-btn>
    </div>
    <v-file-input
      :model-value="chosen"
      :label="current ? `Replace ${field.label.toLowerCase()}` : label"
      :accept="picture ? 'image/png,image/jpeg,image/gif,image/webp' : undefined"
      :error-messages="errorMessages"
      :prepend-icon="picture ? '$image' : '$attachFile'"
      variant="outlined"
      density="comfortable"
      clearable
      hide-details="auto"
      @update:model-value="(file) => emit('update:chosen', Array.isArray(file) ? file[0] || null : file || null)"
    />
  </div>
</template>
