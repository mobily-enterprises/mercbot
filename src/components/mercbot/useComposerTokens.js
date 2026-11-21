import { computed, nextTick, ref, watch } from "vue";
import { botsApi } from "./botsApi.js";
import { botFace } from "./chatView.js";
import { pluginsApi } from "./pluginsApi.js";

/**
 * The bots a chat's @ offers: its bots, as the avatars draw them, but never an archived one (D-108).
 * @param {import("../../types.js").Chat | null} chat
 */
export const mentionBotsOf = (chat) => (chat?.bots || []).filter((bot) => !bot.archived).map(botFace);

/**
 * The chat's one bot that answers, if it has exactly one: an archived bot doesn't answer, so neither "/" nor @ offers it.
 * @param {import("../../types.js").Chat | null} chat
 */
export function soleBotOf(chat) {
  const answering = (chat?.bots || []).filter((bot) => !bot.archived);
  return answering.length === 1 ? answering[0] : null;
}

/**
 * Whether "/" offers the person's own skills in a chat: only in a private chat whose one person they are, the only chat
 * where the server lets its bot read them (rowPolicies.js personalRule). Mercbot's skills are offered in any chat with
 * one bot.
 * @param {import("../../types.js").Chat | null} chat
 * @param {string} me
 */
export const offersOwnSkills = (chat, me) =>
  chat?.kind === "private" && (chat.people || []).length === 1 && Boolean(me) && String(chat.people[0].userId) === String(me);

/**
 * Mentions: in a chat of several (more than one bot or more than one person), @ opens a menu of everyone, the chat's
 * bots and the person's apps. A chosen one stays in the text as "@Name" and acts as one unit: Backspace or Delete
 * takes the whole token, and the caret can't stop inside it. A layer behind the text draws tokens in the bot's colour
 * with its avatar over the "@". Sending turns them into markers. `draft` is the composer's text, `several` whether the
 * chat has several (messageAuthors.js hasSeveral), `mentionBots` the bots @ offers (mentionBotsOf), `chatId` the
 * open chat, whose change clears the tokens, and `ownSkills` whether "/" offers the person's own skills there too.
 * @param {object} options
 * @param {import("vue").Ref<HTMLTextAreaElement | null>} options.input The composer's field.
 */
export function useComposerTokens({ draft, input, several, mentionBots, chatId, ownSkills = () => false }) {
  const tokens = ref([]);
  const apps = ref(null);
  const mention = ref(null);

  watch(chatId, () => {
    tokens.value = [];
    mention.value = null;
  });
  const tokenText = (token) => `${token.prefix || "@"}${token.label}`;
  watch(draft, (text) => {
    tokens.value = tokens.value.filter((token) => text.includes(tokenText(token)));
  });

  // Skills: "/" at the start of the composer of a chat with exactly one bot opens a picker of up to five skills (short
  // queries match anywhere, longer ones the start of the name), for that bot. The chosen one becomes a token in the
  // bot's colour, sent as <@skill:ID>.
  const skillList = ref(null);
  const slash = ref(null);
  async function loadSkills() {
    if (skillList.value) return;
    skillList.value = [];
    try {
      skillList.value = (await botsApi.skills()).skills;
    } catch {
      skillList.value = [];
    }
  }
  const skillRows = computed(() => {
    if (!slash.value) return [];
    const query = slash.value.query.trim().toLowerCase();
    const matches = (skill) => !query || (query.length <= 2
      ? `${skill.name} ${skill.description}`.toLowerCase().includes(query)
      : skill.name.toLowerCase().startsWith(query));
    return (skillList.value || []).filter((skill) => !skill.own || ownSkills()).filter(matches).slice(0, 5);
  });

  function updateSlash() {
    const field = input.value;
    const before = field ? draft.value.slice(0, field.selectionStart) : "";
    const found = /^\/([^\n/]{0,40})$/u.exec(before);
    if (mentionBots.value.length !== 1 || !found || tokens.value.some((token) => token.kind === "skill")) {
      slash.value = null;
      return;
    }
    slash.value = { query: found[1], active: slash.value?.query === found[1] ? slash.value.active : 0 };
    loadSkills();
  }

  function insertSkill(row) {
    const field = input.value;
    const text = `/${row.name} `;
    draft.value = `${text}${draft.value.slice(field.selectionStart)}`;
    tokens.value = [...tokens.value, { key: `skill-${row.id}`, kind: "skill", id: row.id, label: row.name, prefix: "/" }];
    slash.value = null;
    nextTick(() => {
      field.focus();
      field.setSelectionRange(text.length, text.length);
    });
  }

  const mentionRows = computed(() => {
    if (!mention.value) return [];
    const query = mention.value.query.toLowerCase();
    const rows = [
      { key: "everyone", kind: "everyone", label: "everyone", type: "everyone" },
      ...mentionBots.value.map((bot) => ({ key: `bot-${bot.id}`, kind: "bot", id: bot.id, label: bot.name, bot, type: "bot" })),
      ...(apps.value || []).map((app) => ({
        key: `app-${app.id}`,
        kind: "app",
        id: app.id,
        label: app.name,
        status: app.status,
        type: "app"
      }))
    ];
    return rows.filter((row) => row.label.toLowerCase().startsWith(query));
  });

  async function loadApps() {
    if (apps.value) return;
    apps.value = [];
    try {
      const { plugins } = await pluginsApi.list();
      apps.value = plugins.filter((plugin) => plugin.installed && !plugin.soon).map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        status: plugin.accounts?.some((account) => ["connected", "more-access"].includes(account.status)) ? "connected" : "needs sign-in"
      }));
    } catch {
      apps.value = [];
    }
  }

  function updateMention() {
    updateSlash();
    const field = input.value;
    if (!several.value || !field) {
      mention.value = null;
      return;
    }
    const before = draft.value.slice(0, field.selectionStart);
    const found = /(?:^|\s)@([\p{L}\p{N}_-]{0,24})$/u.exec(before);
    if (!found) {
      mention.value = null;
      return;
    }
    const query = found[1];
    mention.value = {
      query,
      start: field.selectionStart - query.length - 1,
      active: mention.value?.query === query ? mention.value.active : 0
    };
    loadApps();
  }

  function insertMention(row) {
    const field = input.value;
    const { start } = mention.value;
    const end = field.selectionStart;
    const text = `${tokenText(row)} `;
    draft.value = `${draft.value.slice(0, start)}${text}${draft.value.slice(end)}`;
    if (!tokens.value.some((token) => token.key === row.key)) tokens.value = [...tokens.value, row];
    mention.value = null;
    nextTick(() => {
      field.focus();
      field.setSelectionRange(start + text.length, start + text.length);
    });
  }

  // Where each token sits in the text, for deleting and drawing it as one unit.
  function tokenSpans(text = draft.value) {
    const spans = [];
    for (const token of tokens.value) {
      const needle = tokenText(token);
      for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
        spans.push({ start: at, end: at + needle.length, token });
      }
    }
    return spans.sort((a, b) => a.start - b.start);
  }

  function snapCaret() {
    const field = input.value;
    if (!field || !tokens.value.length || field.selectionStart !== field.selectionEnd) return;
    const inside = tokenSpans().find((span) => field.selectionStart > span.start && field.selectionStart < span.end);
    if (inside) field.setSelectionRange(inside.end, inside.end);
  }

  const mirrorParts = computed(() => {
    const parts = [];
    let at = 0;
    for (const span of tokenSpans()) {
      if (span.start < at) continue;
      if (span.start > at) parts.push({ text: draft.value.slice(at, span.start) });
      parts.push({ token: span.token });
      at = span.end;
    }
    parts.push({ text: `${draft.value.slice(at)}\u200b` });
    return parts;
  });

  function withMarkers(text) {
    let result = text;
    for (const token of [...tokens.value].sort((a, b) => b.label.length - a.label.length)) {
      const marker =
        token.kind === "bot"
          ? `<@bot:${token.id}>`
          : token.kind === "app"
            ? `<@app:${token.id}>`
            : token.kind === "skill"
              ? `<@skill:${token.id}>`
              : "<@everyone>";
      result = result.split(tokenText(token)).join(marker);
    }
    return result;
  }

  return {
    tokens,
    mention,
    slash,
    skillRows,
    mentionRows,
    updateMention,
    insertSkill,
    insertMention,
    tokenSpans,
    snapCaret,
    mirrorParts,
    withMarkers
  };
}
