// Everyday chat (D-48): quick messages a regular bot should answer quickly and sensibly. Judged on
// the reply's words; the runner records how long it took.
export function pass(notes = "") { return { pass: true, notes }; }
export function fail(notes) { return { pass: false, notes }; }
