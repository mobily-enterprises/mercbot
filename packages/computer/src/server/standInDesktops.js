import { isStagingOrProduction } from "@jskit-ai/kernel/shared/support/appEnvironment";

// A plain screen, 64 by 40: what every stand-in computer shows.
const SCREEN = Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAoAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCr/wAIrrn/AD4/+RU/xo/4RXXP+fH/AMip/jXplFXzE2PM/wDhFdc/58f/ACKn+NH/AAiuuf8APj/5FT/GvTKKOYLHmf8Awiuuf8+P/kVP8aP+EV1z/nx/8ip/jXplFHMFjzP/AIRXXP8Anx/8ip/jR/wiuuf8+P8A5FT/ABr0yijmCwUUUUhhRRRQAUUUUAFFFFABRRRQAUUUUAFFFFABRRRQB//Z", "base64");

/**
 * Outside staging and production only (APP_ENV, D-87), with MERCBOT_TEST_DESKTOPS=stand-in: computers that only pretend,
 * for the Test Preview (tests/support/start-test-app.mjs), so a browser test can wake a chat's computer, take it over and
 * hand it back, browse, sign in and teach on it with no desktop, browser or sandbox started on the test host. Null
 * otherwise, and computers are real.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @returns {null | ((dependencies: { changed: Function, store: Function }) => object)} createComputers's createManager
 */
export function standInDesktops(env) {
  if (String(env.MERCBOT_TEST_DESKTOPS || "").trim() !== "stand-in" || isStagingOrProduction(env)) return null;
  return createStandInDesktops;
}

/**
 * The stand-in computers, as createComputerManager answers them: each is asleep until woken, then awake on a blank
 * page, with a plain screenshot and no live screen; whatever it's asked to do succeeds without doing anything.
 * @param {object} dependencies
 * @param {(computerId: string, status: object) => Promise<unknown>} dependencies.changed tells the computers a status
 * @param {(computerId: string, jpeg: Buffer) => Promise<unknown>} dependencies.store keeps a screenshot
 */
function createStandInDesktops({ changed, store }) {
  const computers = new Map();
  const status = (computerId) => ({ state: computers.get(computerId)?.state || "asleep", url: computers.get(computerId)?.url || "", error: "" });
  const page = async (computerId, url, title) => ({ url, title, text: "", screenshot: await store(computerId, SCREEN) });

  async function wake(computerId) {
    if (computers.get(computerId)?.state !== "awake") {
      computers.set(computerId, { state: "awake", url: "about:blank", recording: null });
      await changed(computerId, status(computerId));
    }
    return { computerId, profile: null };
  }

  async function sleep(computerId) {
    computers.set(computerId, { state: "asleep", url: "", recording: null });
    await changed(computerId, status(computerId));
  }

  async function browse(computerId, url) {
    await wake(computerId);
    computers.get(computerId).url = String(url);
    return page(computerId, String(url), "A page");
  }

  async function startSignIn(computerId, url) {
    await wake(computerId);
    return page(computerId, String(url), "Sign in");
  }

  async function fill(computerId, { url = "", ...values } = {}) {
    await wake(computerId);
    return { filled: Object.keys(values).filter((field) => values[field]), url: url || status(computerId).url };
  }

  async function screenshot(computerId) {
    await wake(computerId);
    return store(computerId, SCREEN);
  }

  async function startRecording(computerId) {
    await wake(computerId);
    computers.get(computerId).recording = Date.now();
  }

  function stopRecording(computerId) {
    const started = computers.get(computerId)?.recording;
    if (!started) return null;
    computers.get(computerId).recording = null;
    return { seconds: Math.round((Date.now() - started) / 1000), events: [] };
  }

  async function open(computerId) {
    await wake(computerId);
    return status(computerId);
  }

  // There's no live screen to watch, and nothing to act on, sign in to, hold or put away.
  const noScreen = () => null;
  const acted = async () => ({ success: true });
  const signInPage = async (computerId) => ({ url: status(computerId).url, inChain: false, startedFrom: "" });
  const nothing = async () => {};

  return Object.freeze({
    wake,
    sleep,
    reset: sleep,
    screen: noScreen,
    browse,
    startSignIn,
    act: acted,
    fill,
    signInPage,
    endSignIn: nothing,
    screenshot,
    startRecording,
    stopRecording,
    hold: nothing,
    open,
    status,
    shutdown: nothing
  });
}
