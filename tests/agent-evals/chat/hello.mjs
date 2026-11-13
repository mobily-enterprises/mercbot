import { fail, pass } from "./helpers.mjs";
export const builder = false;
export const prompt = "Hi! How are you today?";
export async function judge(ctx) {
  return ctx.reply.trim().length > 3 && ctx.reply.length < 600 ? pass() : fail(`reply: ${ctx.reply.slice(0, 200)}`);
}
