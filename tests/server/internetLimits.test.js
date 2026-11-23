import assert from "node:assert/strict";
import test from "node:test";
import { __testables as shellTestables } from "../../packages/files/src/server/shell.js";
import { __testables, INTERNET_ENV, dayMessage, internetLimits, minuteMessage } from "../../packages/files/src/server/internetUsage.js";

const { untilText } = __testables;
const MB = 1024 ** 2;

// Bots' commands' internet limits (D-127): set by Env names, each with a default when it's unset.
test("the limits' defaults apply when their Env names are unset: 2 GB in and 200 MB out a command, 120 connections a minute a bot, 20 GB a day a home", () => {
  assert.deepEqual(Object.keys(INTERNET_ENV), [
    "MERCBOT_INTERNET_COMMAND_IN_MB", "MERCBOT_INTERNET_COMMAND_OUT_MB", "MERCBOT_INTERNET_CONNECTIONS_PER_MINUTE", "MERCBOT_INTERNET_HOME_DAY_MB"
  ]);
  const limits = { commandIn: 2048 * MB, commandOut: 200 * MB, perMinute: 120, homeDay: 20480 * MB };
  assert.deepEqual({ ...internetLimits({}) }, limits);
  assert.deepEqual({ ...internetLimits({ MERCBOT_INTERNET_COMMAND_IN_MB: "", MERCBOT_INTERNET_HOME_DAY_MB: "  " }) }, limits);
  assert.deepEqual({ ...shellTestables.LIMITS.internet }, limits, "the command line's own limits, without a server's env");
});

test("each Env name sets its limit, in MB or connections a minute; one that isn't a positive number keeps its default and says so", (context) => {
  assert.deepEqual({ ...internetLimits({
    MERCBOT_INTERNET_COMMAND_IN_MB: "100", MERCBOT_INTERNET_COMMAND_OUT_MB: "0.5", MERCBOT_INTERNET_CONNECTIONS_PER_MINUTE: "30",
    MERCBOT_INTERNET_HOME_DAY_MB: "1024"
  }) }, { commandIn: 100 * MB, commandOut: 0.5 * MB, perMinute: 30, homeDay: 1024 * MB });
  const said = [];
  context.mock.method(console, "warn", (line) => said.push(line));
  assert.equal(internetLimits({ MERCBOT_INTERNET_CONNECTIONS_PER_MINUTE: "lots" }).perMinute, 120);
  assert.equal(internetLimits({ MERCBOT_INTERNET_HOME_DAY_MB: "0" }).homeDay, 20480 * MB);
  assert.equal(internetLimits({ MERCBOT_INTERNET_COMMAND_OUT_MB: "-5" }).commandOut, 200 * MB);
  assert.deepEqual(said, [
    'MERCBOT_INTERNET_CONNECTIONS_PER_MINUTE is "lots", which isn\'t a positive number, so its default, 120, applies.',
    'MERCBOT_INTERNET_HOME_DAY_MB is "0", which isn\'t a positive number, so its default, 20480, applies.',
    'MERCBOT_INTERNET_COMMAND_OUT_MB is "-5", which isn\'t a positive number, so its default, 200, applies.'
  ]);
});

test("a bot told its home's day is spent hears when it starts again; one that opened too many connections, when to try again", () => {
  const at = new Date("2026-11-23T20:54:30.000Z");
  assert.equal(dayMessage(20480 * MB, at, "refused"),
    "Mercbot's gateway refused a connection: this home's commands have used 20 GB of internet today, the most a home's " +
    "commands may use in a day. It starts again at midnight UTC, in 3 h 6 min.");
  assert.match(dayMessage(20480 * MB, at, "ended"), /^Mercbot's gateway ended this command's internet connections: this home's commands have used 20 GB/u);
  assert.equal(minuteMessage(120, at),
    "Mercbot's gateway refused a connection: slow down. This bot opened 120 new internet connections this minute, the most a bot may; try again in 30 s.");
  assert.equal(untilText(45 * 1000), "less than a minute");
  assert.equal(untilText(12 * 60 * 1000), "12 min");
  assert.equal(untilText(3 * 3600 * 1000), "3 h");
  assert.equal(untilText(3 * 3600 * 1000 + 5 * 60 * 1000 + 1), "3 h 6 min");
});
