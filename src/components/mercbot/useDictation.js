import { onBeforeUnmount, ref, watch } from "vue";
import { UNSUPPORTED, checkMicrophone, listen, microphoneProblem, voiceSupported } from "./voice.js";
import { currentLanguage, shellPreferences } from "./shellPreferences.js";

const HOLD_MS = 350;

/**
 * Dictation: a click toggles listening; holding the mic button or Ctrl+D
 * talks until release. The words appear in the message box as they're heard, after what was
 * already there. A missing or refused microphone shows the microphone popover.
 * A voice conversation: the call bar shows at once; if the microphone can't be used it
 * closes and the popover explains. What you say is sent as an ordinary message.
 * `draft` is the composer's text, `botId` the open bot (switching stops both), `focusComposer`
 * returns the caret after dictation, and `voiceEnded` reports a finished call's length in seconds.
 * @param {{ draft: import("vue").WritableComputedRef<string>, botId: () => string, focusComposer: () => void, voiceEnded: (seconds: number) => void }} options
 */
export function useDictation({ draft, botId, focusComposer, voiceEnded }) {
  const micError = ref(null);
  const dictating = ref(false);
  const calling = ref(false);
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
    if (dictating.value) stopDictation();
    micError.value = null;
    calling.value = true;
  }

  function callFailed(problem) {
    calling.value = false;
    micError.value = problem;
  }

  function callEnded(seconds) {
    calling.value = false;
    voiceEnded(seconds);
  }

  watch(botId, () => {
    stopDictation();
    calling.value = false;
  });
  onBeforeUnmount(stopDictation);

  return { micError, dictating, calling, dictationPress, dictationRelease, toggleDictation, startCall, callFailed, callEnded };
}
