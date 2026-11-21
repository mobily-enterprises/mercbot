import { computed, onBeforeUnmount, ref, watch } from "vue";
import { UNSUPPORTED, checkMicrophone, listen, microphoneProblem, voiceSupported } from "./voice.js";
import { currentLanguage, shellPreferences } from "./shellPreferences.js";

const HOLD_MS = 350;

/**
 * Dictation: a click toggles listening; holding the mic button or Ctrl+D
 * talks until release. The words appear in the message box as they're heard, after what was
 * already there. A missing or refused microphone shows the microphone popover.
 * A voice conversation is with one bot, so it's offered only in a direct chat (`canCall`): the call bar shows at once;
 * if the microphone can't be used it closes and the popover explains. What you say is sent as an ordinary message.
 * `draft` is the composer's text, `chatId` the open chat (switching stops both), `botId` its direct chat's bot (null in
 * any other chat), `focusComposer` returns the caret after dictation, and `voiceEnded` reports a finished call: the
 * chat and bot it was with, and its length in seconds.
 * @param {{
 *   draft: import("vue").WritableComputedRef<string>,
 *   chatId: () => string | null,
 *   botId: () => string | null,
 *   focusComposer: () => void,
 *   voiceEnded: (call: { chatId: string, botId: string, seconds: number }) => void
 * }} options
 */
export function useDictation({ draft, chatId, botId, focusComposer, voiceEnded }) {
  const micError = ref(null);
  const dictating = ref(false);
  const calling = ref(false);
  const canCall = computed(() => Boolean(chatId() && botId()));
  // The chat and bot of the call on now, kept from its start so the call is counted where it was made.
  let callWith = null;
  let dictation = null;
  let pressedAt = 0;
  let startedByPress = false;

  async function startDictation() {
    if (!voiceSupported()) {
      micError.value = UNSUPPORTED;
      return;
    }
    try {
      await checkMicrophone(shellPreferences.microphoneId);
    } catch (error) {
      micError.value = microphoneProblem(error);
      return;
    }
    micError.value = null;
    const before = draft.value;
    const join = before && !/\s$/u.test(before) ? " " : "";
    dictating.value = true;
    dictation = listen({
      lang: currentLanguage(),
      onText: (finalText, interim) => { draft.value = `${before}${join}${finalText}${interim}`; },
      onError: (event) => { micError.value = microphoneProblem(event); },
      onEnd: (finalText) => {
        draft.value = `${before}${finalText ? join : ""}${finalText}`;
        dictating.value = false;
        dictation = null;
        focusComposer();
      }
    });
  }

  function stopDictation() {
    dictation?.stop();
  }

  function dictationPress() {
    pressedAt = Date.now();
    startedByPress = !dictating.value;
    if (dictating.value) stopDictation();
    else startDictation();
  }

  function dictationRelease() {
    if (startedByPress && Date.now() - pressedAt > HOLD_MS) stopDictation();
    startedByPress = false;
  }

  function toggleDictation() {
    if (dictating.value) stopDictation();
    else startDictation();
  }

  function startCall() {
    if (!canCall.value) return;
    if (dictating.value) stopDictation();
    micError.value = null;
    callWith = { chatId: String(chatId()), botId: String(botId()) };
    calling.value = true;
  }

  function callFailed(problem) {
    calling.value = false;
    callWith = null;
    micError.value = problem;
  }

  function callEnded(seconds) {
    calling.value = false;
    if (callWith) voiceEnded({ ...callWith, seconds });
    callWith = null;
  }

  watch(chatId, () => {
    stopDictation();
    calling.value = false;
  });
  onBeforeUnmount(stopDictation);

  return { micError, dictating, calling, canCall, dictationPress, dictationRelease, toggleDictation, startCall, callFailed, callEnded };
}
