/** One value as a single-quoted shell word. */
export const quote = (value) => `'${String(value).replace(/'/gu, "'\\''")}'`;
