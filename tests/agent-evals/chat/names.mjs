import { fail, pass } from "./helpers.mjs";
export const builder = false;
export const prompt = "Give me three short name ideas for a neighbourhood bakery.";
export async function judge(ctx) {
  const lines = ctx.reply.split("\n").filter((line) => /^\s*([-*•]|\d+[.)])\s+\S/u.test(line));
  return lines.length >= 3 ? pass() : fail(`reply: ${ctx.reply.slice(0, 300)}`);
}
