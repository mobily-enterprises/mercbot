import { computed, ref } from "vue";
import { pluginsApi } from "./pluginsApi.js";

/**
 * A private skill's page in Connect apps and skills: its name, description and
 * instructions edit in place and save together; Delete asks once more on the same button.
 * @param {{
 *   skills: import("vue").Ref<Array<Record<string, any>>>,
 *   page: import("vue").Ref<string>,
 *   showToast: (text: string) => void,
 *   onFailure: (error: unknown) => void
 * }} options
 */
export function usePrivateSkill({ skills, page, showToast, onFailure }) {
  const skill = ref(null);
  const skillDraft = ref({ name: "", description: "", instructions: "" });
  const confirmingDelete = ref(false);

  function openSkill(entry) {
    confirmingDelete.value = false;
    skill.value = entry;
    skillDraft.value = { name: entry.name, description: entry.description, instructions: entry.instructions };
    page.value = "skill";
  }

  const skillChanged = computed(() => skill.value && (
    skillDraft.value.name !== skill.value.name ||
    skillDraft.value.description !== skill.value.description ||
    skillDraft.value.instructions !== skill.value.instructions
  ));

  async function saveSkill() {
    try {
      const { skill: saved } = await pluginsApi.updateSkill(skill.value.id, skillDraft.value);
      skills.value = skills.value.map((entry) => (entry.id === saved.id ? saved : entry));
      skill.value = saved;
      showToast("Skill saved.");
    } catch (error) {
      onFailure(error);
    }
  }

  async function deleteSkill() {
    if (!confirmingDelete.value) {
      confirmingDelete.value = true;
      return;
    }
    confirmingDelete.value = false;
    try {
      await pluginsApi.deleteSkill(skill.value.id);
      skills.value = skills.value.filter((entry) => entry.id !== skill.value.id);
      page.value = "manage";
    } catch (error) {
      onFailure(error);
    }
  }

  return { skill, skillDraft, confirmingDelete, openSkill, skillChanged, saveSkill, deleteSkill };
}
