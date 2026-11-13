import { fail, pass } from "./helpers.mjs";
export const builder = false;
export const prompt = "Suggest a quick vegetarian dinner I can make in 20 minutes, with a short ingredient list.";
export async function judge(ctx) {
  return ctx.reply.length > 80 && /[-*•]|\d+[.)]/u.test(ctx.reply) ? pass() : fail(`reply: ${ctx.reply.slice(0, 300)}`);
}
