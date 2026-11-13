import { fail, pass } from "./helpers.mjs";
export const builder = false;
export const prompt = "Make this sound friendlier, one sentence: \"Your invoice is overdue. Pay now.\"";
export async function judge(ctx) {
  return /invoice/iu.test(ctx.reply) && ctx.reply.length < 500 ? pass() : fail(`reply: ${ctx.reply.slice(0, 300)}`);
}
