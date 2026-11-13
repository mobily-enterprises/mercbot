import { computed, ref, watch } from "vue";
import { peopleApi } from "./homesApi.js";

/**
 * A group's bots and people in its Details (D-46). Members: hovering a row offers Remove
 * (after asking); the add row opens a searchable list of the bots not in the group. A group keeps at
 * least one bot. People: anyone in the group adds people from the home; the group's maker and the
 * home's owners and admins remove them; anyone can leave. The maker is listed first.
 * @param {{
 *   bot: () => import("../../types.js").Bot,
 *   allBots: () => Array<import("../../types.js").Bot>,
 *   me: () => string,
 *   home: import("vue").Ref<{ slug: string } | null>,
 *   manages: import("vue").Ref<boolean>,
 *   onAddMember: (bot: import("../../types.js").Bot) => void,
 *   onAddPerson: (person: { id: string, name: string }) => void,
 *   onFailure: (error: unknown) => void
 * }} options
 */
export function useGroupMembers({ bot, allBots, me, home, manages, onAddMember, onAddPerson, onFailure }) {
  const members = computed(() => bot().members || []);
  const pendingRemoval = ref(null);
  const memberSearch = ref("");
  const addOpen = ref(false);
  const addable = computed(() => {
    const inGroup = new Set(members.value.map((member) => member.id));
    const text = memberSearch.value.trim().toLowerCase();
    return allBots().filter((entry) => entry.kind !== "group" && !entry.creating && !inGroup.has(entry.id) && (!text || entry.name.toLowerCase().includes(text)));
  });
  watch(addOpen, (open) => {
    if (open) memberSearch.value = "";
  });

  function addMember(entry) {
    addOpen.value = false;
    onAddMember(entry);
  }

  const people = computed(() => bot().people || []);
  const homePeople = ref([]);
  const personOpen = ref(false);
  const pendingPerson = ref(null);
  const maker = computed(() => people.value[0]?.id || "");
  const canRemove = (person) => person.id !== me() && person.id !== maker.value && (me() === maker.value || manages.value);
  const addablePeople = computed(() => {
    const inGroup = new Set(people.value.map((person) => person.id));
    return homePeople.value.filter((person) => !inGroup.has(person.id));
  });
  watch(personOpen, async (open) => {
    if (!open || !home.value) return;
    try {
      homePeople.value = (await peopleApi.members(home.value.slug)).map((member) => ({
        id: String(member.userId),
        name: member.displayName || String(member.email || "").split("@")[0] || "Someone"
      }));
    } catch (error) {
      onFailure(error);
    }
  });

  function addPerson(person) {
    personOpen.value = false;
    onAddPerson(person);
  }

  return { members, pendingRemoval, memberSearch, addOpen, addable, addMember, people, personOpen, pendingPerson, canRemove, addablePeople, addPerson };
}
