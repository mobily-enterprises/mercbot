import { generateOnce } from "@jskit-ai/agent/server";
import { BotsError } from "./botsError.js";

const RULE_MATCHER = [
  "You decide which of a person's plain-language rules apply to an action their assistant wants to take.",
  "Reply with JSON only: {\"matches\": [rule numbers that clearly apply]}. Use [] when none apply."
].join("\n");

/**
 * The person's rules that clearly apply to an action, as the model judges them.
 * @param {import("./types.js").ChatModel} model
 * @param {{ id: string, action: string, behaviour: string }[]} rules
 * @param {string} action
 */
export async function matchRules(model, rules, action) {
  if (!rules.length) return [];
  const listed = rules.map((rule, index) => `${index + 1}. When the bot wants to ${rule.action}`).join("\n");
  const prompt = `Action: ${action}\nRules:\n${listed}`;
  const text = await generateOnce({ model, system: RULE_MATCHER, messages: [{ role: "user", content: prompt }] });
  try {
    const parsed = JSON.parse(String(text || "").replace(/^```(json)?|```$/gu, "").trim());
    return (parsed.matches || []).map((number) => rules[Number(number) - 1]).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * A person's approval rules and auto-review, and the decision each write action gets.
 *
 * Asking first (docs/architecture.md §3.7). Every write action goes through decide():
 * a matching "ask" rule always wins; a matching "allow" rule lets it run; otherwise
 * auto-review decides (on by default, which asks). Reversible actions, like setting up a
 * routine, only ask when a rule says so.
 * The person is the call's: the signed-in user, or the one a background turn works for.
 * @param {object} dependencies
 * @param {import("./types.js").PolicyRepository} dependencies.policies
 * @param {(rules: { id: string, action: string, behaviour: string }[], action: string) => Promise<object[]>} dependencies.match
 *   which rules apply to an action (matchRules with the chat model; tests pass their own)
 */
export function createApprovals({ policies, match }) {
  /** @param {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} options */
  const policy = (options) => policies.policy(options);

  async function setAutoReview(enabled, options) {
    await policies.setAutoReview(enabled, options);
    return policy(options);
  }

  function cleanRule(input = {}) {
    const action = String(input.action || "").trim().slice(0, 200);
    const behaviour = input.behaviour === "ask" ? "ask" : "allow";
    if (!action) throw new BotsError(400, "Describe the action first.", { code: "bots_rule_action_missing" });
    return { action, behaviour };
  }

  async function addRule(input, options) {
    await policies.addRule(cleanRule(input), options);
    return policy(options);
  }

  async function updateRule(ruleId, input, options) {
    if (!(await policies.updateRule(ruleId, cleanRule(input), options))) {
      throw new BotsError(404, "Rule not found.", { code: "bots_rule_not_found" });
    }
    return policy(options);
  }

  async function deleteRule(ruleId, options) {
    await policies.deleteRule(ruleId, options);
    return policy(options);
  }

  /** Returns "ask" or "allow" for a write action described in plain words. */
  async function decide(action, { reversible = false } = {}, options) {
    const { autoReview, rules } = await policy(options);
    let matched = [];
    try {
      matched = await match(rules, action);
    } catch {
      matched = [];
    }
    if (matched.some((rule) => rule.behaviour === "ask")) return "ask";
    if (matched.some((rule) => rule.behaviour === "allow")) return "allow";
    return autoReview && !reversible ? "ask" : "allow";
  }

  return Object.freeze({
    policy,
    // readable-check: allow setter-seam - not a slot: saves whether auto-review asks first
    setAutoReview,
    addRule,
    updateRule,
    deleteRule,
    decide
  });
}
