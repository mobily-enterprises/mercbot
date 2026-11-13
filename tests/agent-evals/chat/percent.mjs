import { fail, pass } from "./helpers.mjs";
export const builder = false;
export const prompt = "Quick one: what's 15% of 84 euros?";
export async function judge(ctx) {
  return /12[.,]60?\b/u.test(ctx.reply) ? pass() : fail(`reply: ${ctx.reply.slice(0, 200)}`);
}
