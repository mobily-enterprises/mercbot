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
  // Which listening session may still write the message box: the recognition reports its last words a moment after
  // it's told to stop, and by then the message may have been sent or another chat opened, whose box they'd land in.
  let session = 0;
  // What the listening last wrote in the message box, to tell it from a box emptied by sending.
  let written = null;
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
    const mine = (session += 1);
    const current = () => mine === session;
    dictation = listen({
      lang: currentLanguage(),
      onText: (finalText, interim) => {
        if (current()) draft.value = written = `${before}${join}${finalText}${interim}`;
      },
      onError: (event) => {
        if (current()) micError.value = microphoneProblem(event);
      },
      onEnd: (finalText) => {
        if (!current()) return;
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

  // Ends the listening for good: whatever the recognition still reports is dropped.
  function abandonDictation() {
    if (!dictating.value) return;
    session += 1;
    dictation?.stop();
    dictation = null;
    dictating.value = false;
  }

  function dictationPress() {
    pressedAt = Date.now();
    startedByPress = !dictating.value;
    toggleDictation();
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
    abandonDictation();
    calling.value = false;
  });
  // The message box emptied by anything but the listening itself: the message was sent (or cleared), so these words are
  // done with. At once, as a send and the words heard just before it can come in the same moment.
  watch(() => draft.value, (text) => {
    if (!text && text !== written) abandonDictation();
  }, { flush: "sync" });
  onBeforeUnmount(abandonDictation);

  return { micError, dictating, calling, canCall, dictationPress, dictationRelease, toggleDictation, startCall, callFailed, callEnded };
}
