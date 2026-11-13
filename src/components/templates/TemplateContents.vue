<script setup>
import { ref } from "vue";

// Everything a template gives a bot (D-43): its instructions, its skills with their full
// steps, the routines it sets up and the apps it can use. On a template's page a menu picks one;
// in the app's preview before Add bot (`all`), every part is shown, so nothing is hidden.
defineProps({
  template: { type: Object, required: true },
  all: { type: Boolean, default: false }
});
const PARTS = [
  { id: "instructions", name: "Instructions", hint: "What it's told to do" },
  { id: "skills", name: "Skills", hint: "Playbooks it can run" },
  { id: "routines", name: "Routines", hint: "Jobs it runs on its own" },
  { id: "apps", name: "Apps", hint: "What it can use" }
];
const chosen = ref("instructions");
const paragraphs = (text) => String(text || "").split(/\n\s*\n/u).map((part) => part.trim()).filter(Boolean);
</script>

<template>
  <div class="mb-tcontents" :class="{ 'mb-tcontents--all': all }">
    <nav v-if="!all" class="mb-tcontents__menu" aria-label="What this bot is given">
      <button
        v-for="part in PARTS"
        :key="part.id"
        type="button"
        class="mb-tcontents__item"
        :aria-pressed="chosen === part.id"
        @click="chosen = part.id"
      >
        <span class="mb-tcontents__item-name">{{ part.name }}</span>
        <span class="mb-tcontents__item-hint">{{ part.hint }}</span>
      </button>
    </nav>
    <div class="mb-tcontents__panels">
      <template v-for="part in PARTS" :key="part.id">
        <section v-if="all || chosen === part.id" class="mb-tcontents__panel" :aria-label="part.name">
          <h3 v-if="all" class="mb-tcontents__heading">{{ part.name }} <span>{{ part.hint }}</span></h3>
          <template v-if="part.id === 'instructions'">
            <p v-for="(text, index) in paragraphs(template.instructions)" :key="index">{{ text }}</p>
            <p v-if="!template.instructions" class="mb-tcontents__none">Only what every Mercbot bot knows.</p>
          </template>
          <template v-else-if="part.id === 'skills'">
            <div v-for="skill in template.skills" :key="skill.name" class="mb-tcontents__skill">
              <p class="mb-tcontents__skill-name">{{ skill.name }}</p>
              <p class="mb-tcontents__skill-description">{{ skill.description }}</p>
              <p class="mb-tcontents__steps">{{ skill.steps }}</p>
            </div>
            <p v-if="!template.skills?.length" class="mb-tcontents__none">No skills of its own.</p>
          </template>
          <template v-else-if="part.id === 'routines'">
            <div v-for="routine in template.routines" :key="routine.name" class="mb-tcontents__skill">
              <p class="mb-tcontents__skill-name">{{ routine.name }}</p>
              <p class="mb-tcontents__skill-description">{{ routine.when }}</p>
              <p>{{ routine.what }}</p>
            </div>
            <p v-if="!template.routines?.length" class="mb-tcontents__none">No routines. It only works when you ask.</p>
            <p v-else class="mb-tcontents__none">It sets these up during its first conversation, paused, and starts them only when you say so.</p>
          </template>
          <template v-else>
            <ul v-if="template.apps?.length" class="mb-tcontents__apps">
              <li v-for="app in template.apps" :key="app.id">
                <img :src="app.logoImage || `/api/plugins/${app.id}/logo.svg?tile=1`" alt="" width="20" height="20">{{ app.name }}
              </li>
            </ul>
            <p class="mb-tcontents__none">{{ template.apps?.length ? "All optional: it uses them only once you've connected them in Connect apps." : "It doesn't need any connected apps." }}</p>
          </template>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.mb-tcontents {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  gap: 20px;
}

.mb-tcontents--all {
  display: block;
}

.mb-tcontents__menu {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mb-tcontents__item {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mb-tcontents__item[aria-pressed="true"] {
  background: rgb(var(--v-theme-surface-variant));
}

.mb-tcontents__item-name {
  font-size: 14px;
  font-weight: 600;
}

.mb-tcontents__item-hint {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tcontents__panel {
  padding: 18px 20px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface-variant));
  font-size: 14px;
  line-height: 22px;
}

.mb-tcontents--all .mb-tcontents__panel {
  margin-bottom: 12px;
}

.mb-tcontents__panel p {
  margin: 0 0 10px;
}

.mb-tcontents__heading {
  margin: 0 0 10px;
  font-size: 15px;
  font-weight: 600;
}

.mb-tcontents__heading span {
  font-size: 12px;
  font-weight: 400;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tcontents__skill {
  margin-bottom: 14px;
}

.mb-tcontents__skill-name {
  font-weight: 600;
}

.mb-tcontents__panel .mb-tcontents__skill-name,
.mb-tcontents__panel .mb-tcontents__skill-description {
  margin: 0;
}

.mb-tcontents__skill-description,
.mb-tcontents__none {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tcontents__steps {
  margin-top: 6px !important;
  white-space: pre-wrap;
}

.mb-tcontents__apps {
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
}

.mb-tcontents__apps li {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.mb-tcontents__apps img {
  border-radius: 5px;
}

@media (max-width: 720px) {
  .mb-tcontents {
    grid-template-columns: minmax(0, 1fr);
  }

  .mb-tcontents__menu {
    flex-direction: row;
    overflow-x: auto;
  }
}
</style>
