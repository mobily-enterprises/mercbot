import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { trustedProxies } from "../../server.js";

// Behind a load balancer every request comes from the balancer. The server believes X-Forwarded-For only from the
// proxies TRUSTED_PROXIES names (else one on this computer), so each visitor keeps their own address, which the
// sign-in limits count by, and no visitor can choose theirs by sending the header themselves.
async function addressSeen(runtimeEnv, { from, forwardedFor }) {
  const app = Fastify({ trustProxy: trustedProxies(runtimeEnv) });
  app.get("/ip", async (request) => ({ ip: request.ip }));
  try {
    const answer = await app.inject({ url: "/ip", remoteAddress: from, headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {} });
    return answer.json().ip;
  } finally {
    await app.close();
  }
}

test("a visitor behind a proxy TRUSTED_PROXIES names keeps their own address", async () => {
  const env = { TRUSTED_PROXIES: "10.0.0.5,10.0.1.0/24" };
  assert.equal(await addressSeen(env, { from: "10.0.0.5", forwardedFor: "203.0.113.9" }), "203.0.113.9");
  assert.equal(await addressSeen(env, { from: "10.0.1.20", forwardedFor: "198.51.100.7" }), "198.51.100.7");
});

test("anyone else's X-Forwarded-For is not believed", async () => {
  const env = { TRUSTED_PROXIES: "10.0.0.5" };
  assert.equal(await addressSeen(env, { from: "192.0.2.44", forwardedFor: "203.0.113.9" }), "192.0.2.44");
  // Without TRUSTED_PROXIES only a proxy on this computer is believed.
  assert.equal(await addressSeen({}, { from: "10.0.0.5", forwardedFor: "203.0.113.9" }), "10.0.0.5");
  assert.equal(await addressSeen({}, { from: "127.0.0.1", forwardedFor: "203.0.113.9" }), "203.0.113.9");
});

test("a TRUSTED_PROXIES that would believe everyone stops the start", () => {
  assert.throws(() => trustedProxies({ TRUSTED_PROXIES: "true" }), /TRUSTED_PROXIES/u);
  assert.throws(() => trustedProxies({ TRUSTED_PROXIES: "2" }), /TRUSTED_PROXIES/u);
});
