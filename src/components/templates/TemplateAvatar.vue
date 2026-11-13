<script setup>
import iconUrl from "../../../favicon.svg";
import MercbotAvatar from "@/components/mercbot/MercbotAvatar.vue";

// A template's bot, with its creator's mark over the lower right. Mercbot's own
// templates carry the Mercbot mark; a person's shared bot carries their initial.
const props = defineProps({
  template: { type: Object, required: true },
  size: { type: Number, default: 72 }
});
const team = () => Boolean(props.template.team);
const initial = () => (String(props.template.creator || "?").trim()[0] || "?").toUpperCase();
</script>

<template>
  <span class="mb-tavatar" :style="{ width: `${size}px`, height: `${size}px` }">
    <MercbotAvatar :bot="{ id: `template-${template.slug}`, name: template.name, color: template.color, shape: template.shape }" :size="size" still />
    <span class="mb-tavatar__creator" :style="{ width: `${Math.round(size * 0.36)}px`, height: `${Math.round(size * 0.36)}px` }" :title="`By ${template.creator}`">
      <img v-if="team()" :src="iconUrl" alt="">
      <span v-else :style="{ fontSize: `${Math.round(size * 0.17)}px` }">{{ initial() }}</span>
    </span>
  </span>
</template>

<style scoped>
.mb-tavatar {
  position: relative;
  display: inline-flex;
  flex: none;
}

.mb-tavatar__creator {
  position: absolute;
  right: -4%;
  bottom: -4%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 2px solid rgb(var(--v-theme-surface));
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface));
  font-weight: 600;
}

.mb-tavatar__creator img {
  width: 100%;
  height: 100%;
}
</style>
