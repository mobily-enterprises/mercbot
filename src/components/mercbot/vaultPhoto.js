// Photos for the Vault's contact form (MercbotVaultPhoto.vue). What's sent to be read is a JPEG at
// most 1600 pixels on its longest side: plenty to read a card or a letter, a fraction of a phone
// photo's size, and the same whatever the camera or file gave (a HEIC photo the browser can open
// included).
const LONGEST = 1600;

/**
 * A picture (a camera's frame, or an opened image), as a JPEG no larger than LONGEST.
 * @param {CanvasImageSource} picture
 * @param {number} width
 * @param {number} height
 * @returns {Promise<Blob>}
 */
export function photoFrom(picture, width, height) {
  const scale = Math.min(1, LONGEST / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext("2d").drawImage(picture, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The photo couldn't be made."))), "image/jpeg", 0.85);
  });
}

/**
 * A photo file the person chose, made smaller to send.
 * @param {File} file
 */
export async function photoFromFile(file) {
  const bitmap = await createImageBitmap(file);
  try {
    return await photoFrom(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
}
