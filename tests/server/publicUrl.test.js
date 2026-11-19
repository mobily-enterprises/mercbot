import assert from "node:assert/strict";
import test from "node:test";
import { checkPublicUrl, resolveRuntimeEnv } from "../../server/lib/runtimeEnv.js";

// D-65: every link Mercbot sends is built from APP_PUBLIC_URL, never from the request, and a staging or production
// server (APP_ENV, D-87) refuses to start with one that isn't https. Without one it starts: links point at
// http://localhost, as the start log says.
test("a staging or production server refuses an APP_PUBLIC_URL that isn't https, and starts without one", () => {
  for (const APP_ENV of ["staging", "production"]) {
    for (const APP_PUBLIC_URL of [undefined, "", "  "]) {
      assert.doesNotThrow(() => checkPublicUrl({ APP_ENV, APP_PUBLIC_URL }), `${APP_ENV} ${APP_PUBLIC_URL}`);
    }
    for (const APP_PUBLIC_URL of ["example.com", "http://example.com", "ftp://example.com"]) {
      assert.throws(() => checkPublicUrl({ APP_ENV, APP_PUBLIC_URL }), new RegExp(`^Error: In ${APP_ENV}, APP_PUBLIC_URL must be this copy's https address`, "u"), `${APP_ENV} ${APP_PUBLIC_URL}`);
    }
    assert.doesNotThrow(() => checkPublicUrl({ APP_ENV, APP_PUBLIC_URL: "https://mercbot.example" }));
    assert.doesNotThrow(() => checkPublicUrl({ APP_ENV, APP_PUBLIC_URL: "https://mercbot.example", HOST: "0.0.0.0" }));
  }
  // Development, tests and Preview may run without it, whatever NODE_ENV says: it only picks optimised builds.
  assert.doesNotThrow(() => checkPublicUrl({ APP_ENV: "development" }));
  assert.doesNotThrow(() => checkPublicUrl({ APP_ENV: "development", NODE_ENV: "production", APP_PUBLIC_URL: "http://example.com" }));
  assert.doesNotThrow(() => checkPublicUrl({ APP_ENV: "test", APP_PUBLIC_URL: "http://127.0.0.1:3001" }));
  // A copy that doesn't say where it runs is refused, naming the fix.
  assert.throws(() => checkPublicUrl({ NODE_ENV: "production", APP_PUBLIC_URL: "https://mercbot.example" }), /APP_ENV is not set\. Set APP_ENV to development, test, staging or production/u);
});

// A person's own copy (docs/standalone-plan.md, question 4): http on this computer, only while the server listens on
// loopback too, so nothing but this computer reaches the address it gives out.
test("a production server takes an http loopback APP_PUBLIC_URL only while HOST is loopback", () => {
  for (const APP_PUBLIC_URL of ["http://localhost:3001", "http://127.0.0.1:3001", "http://[::1]:3001", "http://localhost"]) {
    for (const HOST of ["127.0.0.1", "::1"]) {
      assert.doesNotThrow(() => checkPublicUrl({ APP_ENV: "production", APP_PUBLIC_URL, HOST }), `${APP_PUBLIC_URL} on ${HOST}`);
    }
    for (const HOST of [undefined, "", "0.0.0.0", "::", "192.168.1.5", "localhost", "127.0.0.1.example"]) {
      assert.throws(() => checkPublicUrl({ APP_ENV: "production", APP_PUBLIC_URL, HOST }), /needs HOST set to 127\.0\.0\.1 or ::1/u, `${APP_PUBLIC_URL} on ${HOST}`);
    }
  }
  for (const APP_PUBLIC_URL of ["http://mercbot.example", "http://127.0.0.2:3001", "http://localhost.example:3001", "http://192.168.1.5:3001"]) {
    assert.throws(() => checkPublicUrl({ APP_ENV: "production", APP_PUBLIC_URL, HOST: "127.0.0.1" }), /APP_PUBLIC_URL must be this copy's https address/u, APP_PUBLIC_URL);
  }
});

// In staging and production a start needs no AUTH_LOCAL_EMAIL_CONFIRMATION: nobody registers on a person's own copy
// (D-81) and Mercbot sends no confirmation links, so it's "false" unless it's set, whatever else is (JSKIT would
// otherwise stop the start for want of a sender). A copy built on Mercbot that confirms new accounts' addresses sets it;
// development shows the links. Before anything else, the start stops with JSKIT's words unless APP_ENV says where the
// copy runs (D-87).
test("in staging and production, AUTH_LOCAL_EMAIL_CONFIRMATION is false unless it's set; a start without APP_ENV stops", () => {
  const names = ["APP_ENV", "NODE_ENV", "SIDE_EFFECTS", "APP_PUBLIC_URL", "AUTH_LOCAL_EMAIL_CONFIRMATION"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const resolved = (env) => {
    for (const name of names) process.env[name] = env[name] ?? "";
    return resolveRuntimeEnv();
  };
  const confirmation = (env) => resolved(env).AUTH_LOCAL_EMAIL_CONFIRMATION;
  try {
    for (const APP_ENV of ["staging", "production"]) {
      const stagingOrProduction = { APP_ENV, NODE_ENV: "production", APP_PUBLIC_URL: "https://mercbot.example" };
      for (const env of [stagingOrProduction, { APP_ENV, NODE_ENV: "production" }, { ...stagingOrProduction, AUTH_LOCAL_EMAIL_CONFIRMATION: "  " }]) {
        assert.equal(confirmation(env), "false", JSON.stringify(env));
      }
      assert.equal(confirmation({ ...stagingOrProduction, AUTH_LOCAL_EMAIL_CONFIRMATION: "true" }), "true", "set, it stands");
      assert.equal(confirmation({ APP_ENV, NODE_ENV: "production", AUTH_LOCAL_EMAIL_CONFIRMATION: "false" }), "false", "set, it stands");
    }
    assert.equal(confirmation({ APP_ENV: "development" }), "");
    assert.equal(confirmation({ APP_ENV: "development", NODE_ENV: "production" }), "", "NODE_ENV only picks optimised builds");
    assert.equal(confirmation({ APP_ENV: "development", AUTH_LOCAL_EMAIL_CONFIRMATION: "true" }), "true");
    assert.throws(() => resolved({ NODE_ENV: "production" }), /APP_ENV is not set/u);
    assert.throws(() => resolved({ APP_ENV: "live" }), /APP_ENV is "live", which is not an environment JSKIT knows/u);
    assert.throws(() => resolved({ APP_ENV: "production", NODE_ENV: "production", SIDE_EFFECTS: "live" }), /SIDE_EFFECTS was replaced by APP_ENV: remove SIDE_EFFECTS/u);
    assert.throws(() => resolved({ APP_ENV: "production" }), /APP_ENV is production, so NODE_ENV must be production/u);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
