<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotIconButton from "./MercbotIconButton.vue";
import { pieceLine, pieceProgress, useBotKnowledge } from "./useBotKnowledge.js";

// A bot's Knowledge (D-107), on its Details tab under its Instructions: what it knows, for everyone it talks with. One
// sentence, then each piece of text or file with its size and whether it's always in mind or searched first (a book
// is read and got ready in the background, with its progress, and says what to do when it fails), a summary of what
// it adds to each message, and Add text and Add file for its maker and the home's owners and admins. A piece opens in
// an editor the size of the app's other dialogs, which fills the screen on a phone.
const props = defineProps({
  bot: { type: Object, required: true },
  tab: { type: String, required: true }
});
const emit = defineEmits(["failure"]);

const display = useDisplay();
const phone = computed(() => display.width.value < 600);
const { known, loadFailed, pieces, summary, adding, editor, removing, load, openNew, openPiece, saveEditor, addFiles, confirmRemove, retry } =
  useBotKnowledge({
    bot: () => props.bot,
    isGroup: computed(() => props.bot.kind === "group"),
    tab: computed(() => props.tab),
    onFailure: (error) => emit("failure", error)
  });

const canChange = computed(() => Boolean(known.value?.canChange));
const fileInput = ref(null);
const titleField = ref(null);
const textField = ref(null);
// Files Mercbot reads text from (the office apps' and plain text), as the file picker offers them.
const READABLE = ".pdf,.docx,.doc,.odt,.rtf,.html,.htm,.xlsx,.xls,.xlsm,.ods,.pptx,.txt,.md,.csv,.tsv,.json,.xml";

const editorOpen = computed({ get: () => Boolean(editor.value), set: (value) => { if (!value && !editor.value?.saving) editor.value = null; } });
const editorChars = computed(() => [...(editor.value?.text || "")].length);
const editorTitle = computed(() => (editor.value?.id ? editor.value.title || "Knowledge" : `Add text to ${props.bot.name}'s knowledge`));
const editorChanged = computed(() => Boolean(editor.value) && (!editor.value.id || editor.value.text !== editor.value.original || editor.value.title !== editorTitleWas.value));
const editorTitleWas = ref("");
const inMindLimit = computed(() => (known.value?.limits.inMind || 40000).toLocaleString());
const removeOpen = computed({ get: () => Boolean(removing.value), set: (value) => { if (!value) removing.value = null; } });

watch(() => editor.value?.id ?? (editor.value ? "new" : null), async (opened) => {
  if (!opened) return;
  editorTitleWas.value = editor.value.title;
  await nextTick();
  (editor.value?.id ? textField.value : titleField.value)?.focus();
});

function chooseFiles(event) {
  const chosen = [...(event.target.files || [])];
  event.target.value = "";
  if (chosen.length) addFiles(chosen);
}
</script>

<template>
  <section v-if="bot.kind !== 'group'" class="mb-knowledge" aria-labelledby="mb-knowledge-title">
    <p id="mb-knowledge-title" class="mb-knowledge__label">Knowledge</p>
    <div v-if="!known && !loadFailed" class="mb-knowledge__skeleton" aria-label="Loading knowledge" />
    <p v-else-if="loadFailed" class="mb-knowledge__sentence" role="alert">
      What {{ bot.name }} knows couldn't be loaded.
      <button type="button" class="mb-knowledge__link" @click="load">Try again</button>
    </p>
    <template v-else>
      <p class="mb-knowledge__sentence">
        {{ pieces.length
          ? `What ${bot.name} knows, for everyone it talks with.`
          : `${bot.name} knows nothing extra yet. Add text or a file, such as a price list, a manual or a book.` }}
      </p>

      <ul v-if="pieces.length" class="mb-knowledge__list" aria-label="What it knows">
        <li v-for="piece in pieces" :key="piece.id" class="mb-knowledge__piece" :data-knowledge="piece.title">
          <button type="button" class="mb-knowledge__open" :disabled="piece.state === 'reading'" @click="openPiece(piece)">
            <v-icon :icon="piece.kind === 'file' ? '$description' : '$article'" size="18" class="mb-knowledge__icon" />
            <span class="mb-knowledge__text">
              <span class="mb-knowledge__title">{{ piece.title }}</span>
              <span class="mb-knowledge__line" :class="{ 'mb-knowledge__problem': piece.state === 'failed' }">{{ pieceLine(piece) }}</span>
            </span>
          </button>
          <MercbotIconButton
            v-if="canChange"
            icon="$delete"
            :label="`Remove ${piece.title}`"
            size="x-small"
            :icon-size="16"
            @click="removing = piece"
          />
          <v-progress-linear
            v-if="pieceProgress(piece).shown"
            class="mb-knowledge__progress"
            :model-value="pieceProgress(piece).value ?? 0"
            :indeterminate="pieceProgress(piece).value === null"
            color="primary"
            bg-color="surface-container-highest"
            height="3"
            rounded
            :aria-label="`${piece.title}: ${pieceLine(piece)}`"
          />
          <div v-if="piece.state === 'failed' && canChange" class="mb-knowledge__retry">
            <button type="button" class="mb-set-pill" @click="retry(piece)"><v-icon icon="$refresh" size="16" /> Try again</button>
          </div>
        </li>
      </ul>

      <div v-if="summary" class="mb-knowledge__summary">
        <p v-if="summary.inMind">{{ summary.inMind }}</p>
        <p v-if="summary.searched">{{ summary.searched }}</p>
        <p v-if="summary.cost">{{ summary.cost }}</p>
      </div>

      <div v-if="canChange" class="mb-knowledge__actions">
        <button type="button" class="mb-set-pill" :disabled="Boolean(adding)" @click="openNew"><v-icon icon="$add" size="16" /> Add text</button>
        <button type="button" class="mb-set-pill" :disabled="Boolean(adding)" @click="fileInput?.click()">
          <v-icon icon="$upload" size="16" /> {{ adding ? "Adding…" : "Add file" }}
        </button>
        <input ref="fileInput" type="file" class="mb-knowledge__file" :accept="READABLE" multiple aria-label="Add file" @change="chooseFiles">
      </div>
      <p v-else class="mb-knowledge__note">Only the person who made {{ bot.name }} and the home's owners and admins change what it knows.</p>
    </template>

    <v-dialog v-model="editorOpen" width="auto" :fullscreen="phone" :persistent="Boolean(editor?.saving)">
      <div v-if="editor" class="mb-kedit" :class="{ 'mb-kedit--phone': phone }" role="dialog" aria-labelledby="mb-kedit-title">
        <div class="mb-kedit__head">
          <button v-if="phone" type="button" class="mb-kedit__close" aria-label="Close" :disabled="editor.saving" @click="editorOpen = false">
            <v-icon icon="$close" size="18" />
          </button>
          <h2 id="mb-kedit-title" class="mb-kedit__title">{{ editorTitle }}</h2>
          <button v-if="!phone" type="button" class="mb-kedit__close" aria-label="Close" :disabled="editor.saving" @click="editorOpen = false">
            <v-icon icon="$close" size="14" />
          </button>
        </div>
        <div class="mb-kedit__body">
          <label for="mb-kedit-name" class="mb-kedit__label">Name</label>
          <input
            id="mb-kedit-name"
            ref="titleField"
            v-model="editor.title"
            class="mb-kedit__input"
            maxlength="80"
            :placeholder="editor.id ? '' : 'Such as Price list or Staff handbook'"
            :disabled="!canChange || editor.saving"
          >
          <label for="mb-kedit-text" class="mb-kedit__label mb-kedit__label--text">{{ editor.kind === "file" ? "Its text, read from the file" : "Text" }}</label>
          <div v-if="editor.loading" class="mb-knowledge__skeleton mb-kedit__loading" aria-label="Loading the text" />
          <textarea
            v-else
            id="mb-kedit-text"
            ref="textField"
            v-model="editor.text"
            class="mb-kedit__input mb-kedit__text"
            :readonly="editor.kind === 'file' || !canChange"
            :disabled="editor.saving"
            placeholder="Paste or type what it should know: a price list, opening hours, a manual, a whole book."
          />
          <p class="mb-kedit__hint">
            <template v-if="editor.kind === 'file'">From {{ editor.filePath }}. To change it, add the changed file.</template>
            <template v-else>
              {{ editorChars.toLocaleString() }} characters. Up to {{ inMindLimit }} in all are always in mind; longer text is searched first.
            </template>
          </p>
        </div>
        <div class="mb-kedit__foot">
          <p v-if="editor.problem" class="mb-kedit__problem" role="alert">{{ editor.problem }}</p>
          <button type="button" class="mb-kedit__button" :disabled="editor.saving" @click="editorOpen = false">{{ canChange ? "Cancel" : "Close" }}</button>
          <button
            v-if="canChange"
            type="button"
            class="mb-kedit__button mb-kedit__button--primary"
            :disabled="editor.saving || editor.loading || !editorChanged || (editor.kind === 'text' && !editor.text.trim())"
            @click="saveEditor"
          >
            {{ editor.saving ? "Saving…" : editor.id ? "Save" : "Add" }}
          </button>
        </div>
      </div>
    </v-dialog>

    <MercbotConfirmDialog
      v-model="removeOpen"
      :title="`Remove ${removing?.title || ''}?`"
      :text="removing?.kind === 'file' ? `${bot.name} will no longer know it. The file stays in its Files.` : `${bot.name} will no longer know it.`"
      confirm-label="Remove"
      @confirm="confirmRemove"
    />
  </section>
</template>

<style scoped src="./MercbotKnowledgeSection.css"></style>
