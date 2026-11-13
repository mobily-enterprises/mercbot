<script setup>
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

// The Files entry in the sidebar (D-47), above Apps: the home's files page.
defineProps({ rail: { type: Boolean, default: false } });
const paths = usePaths();
</script>

<template>
  <div class="mb-files-entry" :class="{ 'mb-files-entry--rail': rail }">
    <v-btn :to="paths.page('/files')" variant="text" :prepend-icon="rail ? undefined : '$folder'" :icon="rail ? '$folder' : undefined" :block="!rail" class="mb-files-entry__link" aria-label="Files">
      <template v-if="!rail">Files</template>
    </v-btn>
  </div>
</template>

<style scoped>
.mb-files-entry {
  display: flex;
  flex-direction: column;
  padding: 4px 8px 0;
}
.mb-files-entry--rail {
  align-items: center;
}
.mb-files-entry__link {
  justify-content: flex-start;
  text-transform: none;
  letter-spacing: normal;
}
</style>
