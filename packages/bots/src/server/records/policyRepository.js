// A person's approval rules and auto-review (docs/architecture.md §3.7). Both tables are the
// person's own (ownership `user`): every call reads and writes the caller's rows, in a request the
// signed-in person's and in a job the person it acts for (forWorkspaceUser).

/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceCallOptions} CallOptions */
/** @typedef {import("@jskit-ai/resource-runtime/server/types").ResourceHandle} ResourceHandle */

/**
 * @param {{ botPolicies: ResourceHandle, approvalRules: ResourceHandle }} handles
 */
export function createPolicyRepository({ botPolicies, approvalRules }) {
  /**
   * Whether auto-review is on (it is when the person never set it), and the person's rules in id order.
   * @param {CallOptions} options
   * @returns {Promise<{ autoReview: boolean, rules: Array<{ id: string, action: string, behaviour: string }> }>}
   */
  async function policy(options) {
    const [kept] = await botPolicies.queryAll({ fields: ["autoReview"] }, options);
    const rules = await approvalRules.queryAll({ sort: ["id"], fields: ["action", "behaviour"] }, options);
    return {
      autoReview: kept ? Boolean(kept.autoReview) : true,
      rules: rules.map((rule) => ({ id: String(rule.id), action: rule.action, behaviour: rule.behaviour }))
    };
  }

  /**
   * Saves whether auto-review asks first: one row per person, kept by its unique user_id
   * (ux_bot_policies_key), so two saves at once leave one row.
   * @param {boolean} enabled
   * @param {CallOptions} options
   */
  async function setAutoReview(enabled, options) {
    await botPolicies.createMany([{ autoReview: Boolean(enabled) }], {
      ...options,
      onConflict: { keys: ["userId"], action: "merge", merge: ["autoReview"] }
    });
  }

  /**
   * @param {{ action: string, behaviour: string }} rule
   * @param {CallOptions} options
   */
  async function addRule(rule, options) {
    await approvalRules.create(rule, { ...options, returning: "none" });
  }

  /**
   * Changes one of the person's rules; answers whether it was theirs.
   * @param {string} ruleId
   * @param {{ action: string, behaviour: string }} rule
   * @param {CallOptions} options
   */
  async function updateRule(ruleId, rule, options) {
    return Boolean(await approvalRules.patch(String(ruleId), rule, { ...options, missing: "skip", returning: "id" }));
  }

  /**
   * Deletes one of the person's rules; another person's or a missing one is left alone, as before.
   * @param {string} ruleId
   * @param {CallOptions} options
   */
  async function deleteRule(ruleId, options) {
    await approvalRules.deleteWhere({ id: String(ruleId) }, { ...options, returning: "none" });
  }

  return Object.freeze({
    policy,
    // readable-check: allow setter-seam - not a slot: saves whether auto-review asks first
    setAutoReview,
    addRule,
    updateRule,
    deleteRule
  });
}
