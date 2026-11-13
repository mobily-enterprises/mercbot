// Acting on a message in the chat: the reactions a bot's message offers, and the
// right-click menus of a message and of a picture.

/** The reactions shown on hovering a bot's message, then the rest behind "More reactions". */
export const QUICK_REACTIONS = Object.freeze(["👍", "👎", "❤️", "😂", "🎉"]);
export const MORE_REACTIONS = Object.freeze(["🙌", "👀", "🔥", "🙏", "😮", "😢", "✅"]);
/** The row of six at the top of a bot message's right-click menu. */
export const MENU_REACTIONS = Object.freeze([...QUICK_REACTIONS, "🙏"]);

/** A message as plain text, for Copy: its text, or a list's heading and bullets. */
export const plainText = (message) => message.body.text || [message.body.heading, ...(message.body.bullets || [])].filter(Boolean).join("\n");

/**
 * A message's right-click menu: Reply, Copy and Copy request ID, each with its icon. A bot's
 * message adds the reaction row above them (MercbotContextMenu's `reactions`).
 * @param {object} message
 * @param {{ reply: (message: object) => void, copy: (copied: { text: string, what: string }) => void }} actions
 */
export function messageMenuItems(message, { reply, copy }) {
  return [
    { title: "Reply", icon: "$reply", run: () => reply(message) },
    { title: "Copy", icon: "$contentCopy", run: () => copy({ text: plainText(message), what: "Message" }) },
    { title: "Copy request ID", icon: "$dataObject", run: () => copy({ text: `req_${message.id}`, what: "Request ID" }) }
  ];
}

/**
 * A picture's right-click menu: copy it as a picture, or save it as a file.
 * @param {{ src: string, fileName: string }} picture
 * @param {{ copyPicture: (src: string) => void, savePicture: (picture: { src: string, fileName: string }) => void }} actions
 */
export function pictureMenuItems(picture, { copyPicture, savePicture }) {
  return [
    { title: "Copy image", icon: "$contentCopy", run: () => copyPicture(picture.src) },
    { title: "Save image", icon: "$download", run: () => savePicture(picture) }
  ];
}

/** A picture's file as PNG, which every browser's clipboard takes; other kinds are drawn again as PNG. */
async function pngOf(src) {
  const response = await fetch(src, { credentials: "include" });
  if (!response.ok) throw new Error(`The picture didn't load (${response.status}).`);
  const blob = await response.blob();
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("The picture couldn't be copied."))), "image/png"));
}

/**
 * Copies a picture to the clipboard. The clipboard item takes the picture while it loads, so the
 * copy still counts as the person's own click.
 * @param {string} src
 */
export function copyPictureToClipboard(src) {
  return navigator.clipboard.write([new ClipboardItem({ "image/png": pngOf(src) })]);
}

/**
 * Saves a picture as a file, under its own name.
 * @param {{ src: string, fileName: string }} picture
 */
export function savePictureAsFile({ src, fileName }) {
  const link = document.createElement("a");
  link.href = src;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
}
