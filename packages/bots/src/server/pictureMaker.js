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
