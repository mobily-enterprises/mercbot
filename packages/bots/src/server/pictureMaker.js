import { aiFetch, aiKind, aiReady } from "@local/account/model";

// Making pictures on the images kind of AI (D-72), whose provider's layer draws
// them: portrait (3:4), and, given pictures to start from (an earlier picture, or a photo the person sent), edited
// rather than drawn afresh. What the bot is told when there's no picture is said here. Images is optional: a copy
// without it starts, and a bot asked for a picture says pictures aren't set up there. Each picture is recorded for the
// work in progress through aiFetch, like every AI call (D-73).

export class PictureError extends Error {}

/** What the bot is told, to tell the person, when this copy has no images kind of AI. */
export const PICTURES_NOT_SET_UP =
  "Pictures aren't set up on this copy of Mercbot. Tell the person that plainly, in one line: you can't make or edit pictures here.";

// What the bot is told when a copy that checks pictures (D-90) doesn't allow one: what was asked for, before anything is
// drawn, or a picture once it's made, which is then neither kept nor shown. The checker's own sentence, when it gives
// one, is what the bot says.
const SAY = "Tell the person that plainly, in one line";
const REFUSED = Object.freeze({
  prompt: {
    block: `That picture can't be made from this description, so none was made. ${SAY}, and don't try again with the same description.`,
    unavailable: `Pictures can't be checked right now, so none was made. ${SAY}: they can try again in a few minutes.`
  },
  picture: {
    block: `The picture that was made can't be shown, so it wasn't kept. ${SAY}.`,
    unavailable: `The picture can't be checked right now, so it wasn't kept or shown. ${SAY}: they can try again in a few minutes.`
  }
});

/**
 * What make_picture tells the bot when a check didn't allow what was asked for (`prompt`) or what was made (`picture`).
 * @param {"prompt" | "picture"} what
 * @param {{ verdict: "block" | "unavailable", notice: string | null }} answer the check's
 */
export function pictureRefusal(what, { verdict, notice }) {
  const told = REFUSED[what][verdict === "block" ? "block" : "unavailable"];
  return notice ? `${told} Say it in these words: "${notice}"` : told;
}

/**
 * Whether this copy can make pictures: the images kind of AI is set up, with its key.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function canMakePictures(env) {
  return aiReady(env, "images");
}

/**
 * A picture made from a prompt and the pictures to start from.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @param {string} prompt
 * @param {{ type: string, data: Buffer }[]} [sources]
 * @returns {Promise<{ data: Buffer, type: string }>}
 */
export async function makePicture(env, prompt, sources = []) {
  const images = aiKind(env, "images");
  if (!images?.apiKey) throw new PictureError(PICTURES_NOT_SET_UP);
  const made = await images.layer.makePicture({ baseURL: images.layer.baseURL, apiKey: images.apiKey, prompt, sources, fetch: aiFetch(env, "pictures") });
  if (made.picture) return made.picture;
  if (made.refused === "not-enabled") {
    throw new PictureError(
      "Making pictures isn't switched on for this copy of Mercbot yet (the picture service's billing isn't set up), so say you can't make pictures right now."
    );
  }
  if (made.refused === "busy") throw new PictureError("The picture service is at its limit right now; try again later.");
  if (made.refused === "blocked") throw new PictureError(`The picture couldn't be made (${made.detail}). Try describing it differently.`);
  throw new PictureError(made.detail || "The picture service refused.");
}
