import { createECDH, hkdfSync } from "node:crypto";
import { sendNotification as webPushSend } from "web-push";
import { logSideEffect } from "@jskit-ai/kernel/server/runtime/appEnvironment";
import { appEnvironment } from "@jskit-ai/kernel/shared/support/appEnvironment";
import { AccountError } from "./accountError.js";

// Notifications on people's devices (D-133): web push, the browser's and the installed app's own way to show news while
// Mercbot is closed. A person allows it on each device (a browser or the installed app), which gives a push service
// address and the keys its notifications are sealed with; their settings say which kinds of news notify them, whether
// the message's text shows, and when they're quiet. The server's keys (VAPID) are made from MERCBOT_PUSH_SECRET, so a
// copy needs nothing else set up; without it, push is off. Only production sends: development, test and staging log
// each notification instead (APP_ENV).

/** The kinds of news a notification is for: a routine's or watch's result, a bot waiting for the person, a message. */
export const PUSH_KINDS = Object.freeze(["results", "waiting", "messages"]);
/** Everything on, the text shown, no quiet hours: a person's settings until they change them. */
export const PUSH_DEFAULTS = Object.freeze({
  results: true,
  waiting: true,
  messages: true,
  showText: true,
  quietFrom: null,
  quietTo: null,
  timeZone: null
});
/** A device whose sends fail this many times in a row is forgotten. */
const FAILURES_KEPT = 5;
const DEVICES_PER_PERSON = 20;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/u;
// A notification waits at most this long at the push service for a device that's off.
const TTL_SECONDS = 6 * 60 * 60;

/** The search entries devices and settings add: several people's at once. */
export const PUSH_SEARCH = Object.freeze({
  userIds: Object.freeze({ type: "array", actualField: "userId", filterOperator: "in", items: { type: "integer" } })
});

const base64url = (buffer) => Buffer.from(buffer).toString("base64url");

/**
 * The server's push keys, made from a secret: the same on every server and every start. Answers null without one.
 * @param {string | undefined} secret
 * @returns {{ publicKey: string, privateKey: string } | null}
 */
export function pushKeysOf(secret) {
  if (!secret) return null;
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const privateKey = Buffer.from(hkdfSync("sha256", String(secret), "mercbot-push", `vapid-p256-${attempt}`, 32));
    const ecdh = createECDH("prime256v1");
    try {
      ecdh.setPrivateKey(privateKey);
    } catch {
      continue; // Outside the curve's range, one time in 2^32: the next one is.
    }
    return { publicKey: base64url(ecdh.getPublicKey()), privateKey: base64url(privateKey) };
  }
  return null;
}

/** Whether `at` falls in quiet hours from `from` to `to` (HH:MM, in `timeZone`), which may run past midnight. */
export function inQuietHours({ quietFrom, quietTo, timeZone }, at = new Date()) {
  if (!quietFrom || !quietTo || quietFrom === quietTo) return false;
  let now;
  try {
    now = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timeZone || "UTC" }).format(at);
  } catch {
    now = at.toISOString().slice(11, 16);
  }
  return quietFrom < quietTo ? now >= quietFrom && now < quietTo : now >= quietFrom || now < quietTo;
}

const refusal = (message, code) => new AccountError(400, message, { code });

/**
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources the account feature's handles
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {(subscription: object, payload: string, options: object) => Promise<unknown>} [dependencies.sendNotification] web-push's
 */
export function createPush({ resources, systemContext, env, sendNotification = webPushSend }) {
  const { pushDevices, pushSettings } = resources;
  const keys = pushKeysOf(env.MERCBOT_PUSH_SECRET);
  const system = (reason) => ({ context: systemContext(reason) });
  const subject = env.APP_PUBLIC_URL && /^https:\/\//u.test(env.APP_PUBLIC_URL) ? env.APP_PUBLIC_URL : "mailto:notifications@mercbot.invalid";

  const asSettings = (row) => ({
    ...PUSH_DEFAULTS,
    ...(row ? {
      results: row.results !== false,
      waiting: row.waiting !== false,
      messages: row.messages !== false,
      showText: row.showText !== false,
      quietFrom: row.quietFrom ?? null,
      quietTo: row.quietTo ?? null,
      timeZone: row.timeZone ?? null
    } : {})
  });
  // A device as its person sees it; its push address lets the browser they're on tell which one it is.
  const asDevice = (row) => ({
    id: String(row.id),
    label: row.label || "A device",
    endpoint: row.endpoint,
    createdAt: row.createdAt,
    lastSentAt: row.lastSentAt ?? null
  });

  /** A person's settings and devices, and the key their devices subscribe with (null while push is off). */
  async function mine(userId) {
    const options = system("read a person's notification settings and devices for them");
    const [{ records: [row] }, devices] = await Promise.all([
      pushSettings.query({ filters: { userId: Number(userId) }, page: { size: 1 } }, options),
      pushDevices.queryAll({ filters: { userId: Number(userId) }, sort: ["-id"] }, options)
    ]);
    return { enabled: Boolean(keys), publicKey: keys?.publicKey ?? null, settings: asSettings(row), devices: devices.map(asDevice) };
  }

  /** Changes a person's settings: each kind on or off, the text shown or not, and quiet hours in their time zone. */
  async function saveSettings(userId, input = {}) {
    const changes = {};
    for (const key of [...PUSH_KINDS, "showText"]) {
      if (key in input) {
        if (typeof input[key] !== "boolean") throw refusal("Say on or off.", "account_push_setting");
        changes[key] = input[key];
      }
    }
    for (const key of ["quietFrom", "quietTo"]) {
      if (key in input) {
        if (input[key] !== null && !TIME.test(String(input[key]))) throw refusal("Quiet hours are times like 22:00.", "account_push_quiet_hours");
        changes[key] = input[key];
      }
    }
    if ("timeZone" in input) {
      try {
        new Intl.DateTimeFormat("en", { timeZone: String(input.timeZone) });
      } catch {
        throw refusal("That isn't a time zone.", "account_push_time_zone");
      }
      changes.timeZone = String(input.timeZone);
    }
    const options = system("save a person's notification settings for them");
    const key = { userId: Number(userId) };
    const updated = await pushSettings.patchWhere(key, { ...changes, updatedAt: new Date().toISOString() }, { ...options, returning: "count" });
    if (!updated) {
      await pushSettings.createMany([{ ...key, ...changes }], { ...options, onConflict: { keys: ["userId"], action: "merge" }, returning: "none" });
    }
    return mine(userId);
  }

  /**
   * A device a person allowed notifications on: its push service's address and keys, as the browser's subscription gives
   * them. A device another person had is theirs now (one device, one person: whoever is signed in there now).
   * @param {string} userId
   * @param {{ endpoint?: string, keys?: { p256dh?: string, auth?: string }, label?: string }} subscription
   */
  async function addDevice(userId, { endpoint, keys: sealing = {}, label = "" } = {}) {
    if (!keys) throw new AccountError(409, "Notifications aren't set up on this server.", { code: "account_push_off" });
    let address;
    try {
      address = new URL(String(endpoint));
    } catch {
      throw refusal("That isn't a push address.", "account_push_endpoint");
    }
    if (address.protocol !== "https:" || String(endpoint).length > 2000) throw refusal("That isn't a push address.", "account_push_endpoint");
    if (!/^[\w-]{20,200}$/u.test(String(sealing.p256dh || "")) || !/^[\w-]{8,100}$/u.test(String(sealing.auth || ""))) {
      throw refusal("That device's keys aren't valid.", "account_push_keys");
    }
    const options = system("keep a device a person allowed notifications on");
    const owner = { userId: Number(userId) };
    const row = { ...owner, endpoint: String(endpoint), p256dh: sealing.p256dh, auth: sealing.auth, failures: 0 };
    row.label = String(label).slice(0, 120);
    await pushDevices.createMany([row], { ...options, onConflict: { keys: ["endpoint"], action: "merge" }, returning: "none" });
    // A person keeps their newest devices: past the limit, the oldest go.
    const [{ devices = 0 } = {}] = await pushDevices.aggregate({ filters: owner, measures: { devices: { count: "*" } } }, options);
    const extra = Number(devices) - DEVICES_PER_PERSON;
    if (extra > 0) {
      const oldest = await pushDevices.queryAll({ filters: owner, sort: ["id"], take: extra, fields: ["userId"] }, options);
      await pushDevices.deleteWhere({ id: oldest.map((device) => String(device.id)) }, { ...options, returning: "count" });
    }
    return mine(userId);
  }

  /** Forgets one of a person's devices (only theirs). */
  async function removeDevice(userId, deviceId) {
    if (!/^\d+$/u.test(String(deviceId))) throw new AccountError(404, "There's no such device.", { code: "account_push_device_missing" });
    const options = system("forget one of a person's notification devices for them");
    const removed = await pushDevices.deleteWhere({ id: [String(deviceId)], userId: Number(userId) }, { ...options, returning: "count" });
    if (!removed) throw new AccountError(404, "There's no such device.", { code: "account_push_device_missing" });
    return mine(userId);
  }

  /** People's settings, by user id, in one read: the sweep's. */
  async function settingsOf(userIds) {
    const ids = [...new Set(userIds.map(Number))].filter((id) => id > 0);
    if (!ids.length) return new Map();
    const rows = await pushSettings.queryAll({ filters: { userIds: ids } }, system("read the settings of the people a notification is for"));
    const byUser = new Map(rows.map((row) => [String(row.userId), asSettings(row)]));
    return new Map(ids.map((id) => [String(id), byUser.get(String(id)) || asSettings(null)]));
  }

  /**
   * Sends one notification to each of these people's devices: for real in production, logged elsewhere. A device the
   * push service says is gone is forgotten; one that keeps failing too. Answers how many devices it went to.
   * @param {Array<{ userId: string, payload: { title: string, body: string, url: string, tag: string, unread?: number } }>} notes
   */
  async function send(notes) {
    if (!keys || !notes.length) return 0;
    const options = system("send people's notifications to their devices");
    const devices = await pushDevices.queryAll({ filters: { userIds: [...new Set(notes.map((note) => Number(note.userId)))] } }, options);
    const environment = appEnvironment(env);
    let sent = 0;
    for (const note of notes) {
      for (const device of devices.filter((entry) => String(entry.userId) === String(note.userId))) {
        if (environment !== "production") {
          logSideEffect(console, environment, { kind: "push", summary: `a notification ("${note.payload.title}") to ${device.label || "a device"}` });
          continue;
        }
        try {
          await sendNotification(
            { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
            JSON.stringify(note.payload),
            { TTL: TTL_SECONDS, urgency: "normal", topic: note.payload.tag.replace(/[^\w-]/gu, "").slice(0, 32), vapidDetails: { subject, ...keys } }
          );
          sent += 1;
          await pushDevices.patch(String(device.id), { lastSentAt: new Date().toISOString(), failures: 0 }, { ...options, returning: "none" });
        } catch (error) {
          const gone = error?.statusCode === 404 || error?.statusCode === 410 || Number(device.failures) + 1 >= FAILURES_KEPT;
          if (gone) await pushDevices.deleteWhere({ id: [String(device.id)] }, { ...options, returning: "count" });
          else await pushDevices.patch(String(device.id), { failures: Number(device.failures) + 1 }, { ...options, returning: "none" });
        }
      }
    }
    return sent;
  }

  return Object.freeze({
    enabled: Boolean(keys),
    mine,
    saveSettings,
    addDevice,
    removeDevice,
    settingsOf,
    send
  });
}
