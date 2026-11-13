// Voice in the browser: speech-to-text with the browser's own recognition
// (Chrome, Edge and Safari) and replies read aloud with its speech synthesis. No server service.
const Recognition = typeof window === "undefined" ? null : window.SpeechRecognition || window.webkitSpeechRecognition || null;

export const voiceSupported = () => Boolean(Recognition);
export const UNSUPPORTED = "This browser can't turn speech into text. Try Chrome, Edge or Safari.";

// Why the microphone can't be used, in words for the microphone popover.
export function microphoneProblem(error) {
  const name = error?.error || error?.name || "";
  if (name === "not-allowed" || name === "NotAllowedError" || name === "service-not-allowed") return "this site isn't allowed to use the microphone";
  if (name === "audio-capture" || name === "NotFoundError" || name === "OverconstrainedError") return "no microphone was found";
  if (name === "network") return "speech recognition needs a network connection";
  return String(error?.message || name || "the microphone isn't available");
}

// Checks that a microphone is there and allowed, using the one chosen in Settings.
export async function checkMicrophone(deviceId) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error("this browser can't use a microphone here"), { name: "NotSupported" });
  const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId } : true });
  stream.getTracks().forEach((track) => track.stop());
}

/**
 * One listening session. onText(final, interim) gets the words so far; onEnd fires once it stops.
 * @param {{ lang: string, continuous?: boolean, onText: (finalText: string, interim: string) => void, onEnd: (finalText: string) => void, onError: (event: Event) => void }} options
 */
export function listen({ lang, continuous = true, onText, onEnd, onError }) {
  const recognition = new Recognition();
  recognition.lang = lang;
  recognition.continuous = continuous;
  recognition.interimResults = true;
  let finalText = "";
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) finalText += result[0].transcript;
      else interim += result[0].transcript;
    }
    onText(finalText, interim);
  };
  recognition.onerror = (event) => {
    if (event.error !== "no-speech" && event.error !== "aborted") onError(event);
  };
  recognition.onend = () => onEnd(finalText);
  recognition.start();
  return { stop: () => recognition.stop(), abort: () => recognition.abort() };
}

// A reply as plain sentences for reading aloud: no Markdown, links read as their words.
export function speakable(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/gu, " (code) ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<@[^>]+>/gu, "")
    .replace(/https?:\/\/\S+/gu, "a link")
    .replace(/[*_`#>|]+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function voicesFor(lang) {
  const prefix = String(lang || "en").split("-")[0].toLowerCase();
  return (window.speechSynthesis?.getVoices() || []).filter((voice) => voice.lang.toLowerCase().startsWith(prefix));
}

/**
 * Reads a reply aloud; onEnd fires once it has been read, or at once where the browser can't speak.
 * @param {string} text
 * @param {{ lang: string, voiceName: string, rate?: number, onEnd: () => void }} options
 */
export function speak(text, { lang, voiceName, rate = 1, onEnd }) {
  const synth = window.speechSynthesis;
  if (!synth) {
    onEnd();
    return { stop() {} };
  }
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(speakable(text));
  utterance.lang = lang;
  utterance.rate = rate;
  const voice = voicesFor(lang).find((entry) => entry.name === voiceName);
  if (voice) utterance.voice = voice;
  utterance.onend = () => onEnd();
  utterance.onerror = () => onEnd();
  synth.speak(utterance);
  return { stop: () => synth.cancel() };
}
