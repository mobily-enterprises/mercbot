// A test's setup of many records that don't depend on each other: made several at a time, as
// several people's saves arrive at once, instead of one after another. A record write costs about
// ten statements in AnyAPI (json-rest-api), so 400 made one by one took most of a test's 9 s.

/**
 * `make(index)` for every index below `count`, `width` at a time; the answers in index order.
 * @template T
 * @param {number} count
 * @param {(index: number) => Promise<T>} make
 * @param {number} [width]
 * @returns {Promise<T[]>}
 */
export async function inParallel(count, make, width = 8) {
  const made = [];
  for (let start = 0; start < count; start += width) {
    const batch = Array.from({ length: Math.min(width, count - start) }, (_, offset) => make(start + offset));
    made.push(...(await Promise.all(batch)));
  }
  return made;
}
