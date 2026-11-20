import { computed, ref, watch } from "vue";
import { hasOthers } from "./homesApi.js";

const TITLES = { private: "Private", mixed: "Mixed", shared: "Shared" };

/**
 * Who sees what in a bot (D-36, D-99), as its Details panel offers it. Everyone has their own chat with the bot, and
 * each mode adds to it: Private nothing, Mixed the home's notebook, Shared conversations everyone sees (with each
 * person's own chat as its last tab, "You only"). Every change is asked first, naming what it hides and for whom.
 * A home of one person sees the choice only for a bot off the default (Mixed), so it can always be set back.
 * @param {{
 *   bot: () => { name: string, sharing: string, rooms?: Array<{ title: string, own?: boolean }> | null },
 *   home: import("vue").Ref<{ slug: string, name: string } | null>,
 *   onChoose: (sharing: string) => void
 * }} options
 */
export function useSharingChoice({ bot, home, onChoose }) {
  const homeName = computed(() => home.value?.name || "this home");
  const intro = computed(() => `Everyone in ${homeName.value} has their own chat with ${bot().name}, which only they see.`);
  const options = computed(() => [
    { value: "private", title: "Private", text: "Nothing more." },
    { value: "mixed", title: "Mixed", text: `And what helps everyone goes in ${homeName.value}'s notebook, which everyone can read.` },
    {
      value: "shared",
      title: "Shared",
      text: `And conversations everyone sees, as tabs; each person's own chat is the last tab, You only. The notebook isn't used.`
    }
  ]);

  // Whether anyone but this person is in the home: read once per home, and again when its people change.
  const others = ref(false);
  watch(() => home.value?.slug, async (slug) => {
    others.value = false;
    if (slug) others.value = await hasOthers(slug);
  }, { immediate: true });
  const shown = computed(() => others.value || bot().sharing !== "mixed");

  const pending = ref("");
  const question = computed(() => {
    const to = pending.value;
    if (!to) return null;
    const { name, sharing } = bot();
    const everyone = `everyone in ${homeName.value}`;
    const tabs = (bot().rooms || []).filter((room) => !room.own).map((room) => `“${room.title}”`);
    const notebook = to === "mixed"
      ? ` ${name} notes what helps everyone in ${homeName.value}'s notebook, which ${everyone} can read; anyone can keep their chat out of it.`
      : sharing === "mixed" ? ` ${name} stops using ${homeName.value}'s notebook; its notes are kept.` : "";
    let text;
    if (to === "shared") {
      text = `${name} also talks with ${everyone} in conversations they all see, starting with General. ` +
        `Each person's own chat stays theirs alone, as the last tab, You only.${notebook}`;
    } else if (sharing === "shared") {
      text = `The shared conversations${tabs.length ? ` (${tabs.join(", ")})` : ""} are hidden from ${everyone}, not deleted, ` +
        `until ${name} is Shared again, and their routines and watches pause. Each person's You only becomes their chat with ${name}.${notebook}`;
    } else {
      text = `Each person's chat with ${name} stays theirs alone.${notebook}`;
    }
    return { title: `Make ${name} ${TITLES[to]}?`, text, confirmLabel: `Make it ${TITLES[to]}` };
  });

  /** A mode chosen: asked first. */
  function ask(sharing) {
    if (sharing !== bot().sharing) pending.value = sharing;
  }
  function confirm() {
    const sharing = pending.value;
    pending.value = "";
    if (sharing) onChoose(sharing);
  }
  function cancel() {
    pending.value = "";
  }

  return { intro, options, shown, question, ask, confirm, cancel };
}
