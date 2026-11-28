// The save check's part for an app's computer (D-146, check.js): its own files and whether it reaches the internet.

// An app's own files for its programs (D-146): text, by a name in the program's folder (the files feature's
// shell.js programFileName keeps to the same names), at most COMPUTER_FILES of them and COMPUTER_CHARS in all.
const COMPUTER_FILE = /^(?!.*(?:^|\/)\.)[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}){0,3}$/u;
const COMPUTER_FILES = 30;
const COMPUTER_CHARS = 1000000;

/**
 * `computer`: `{ files: { "name": "text" }, internet: true | false }`, what the app's scripts' computer.run finds
 * read-only in its folder and whether its programs may reach the internet. Members only: a public app has none.
 */
export function checkComputer(computer, { report, isPublic }) {
  if (!computer || typeof computer !== "object" || Array.isArray(computer)) return report("computer", 'is { "files": { "name.py": "its text" }, "internet": false }.');
  if (isPublic) report("computer", "an app whose scripts run programs on its bot's computer stays inside the home: a public app can't have one.");
  for (const key of Object.keys(computer)) if (!["files", "internet"].includes(key)) report(`computer.${key}`, "isn't a setting of the computer: files and internet are.");
  if (computer.internet !== undefined && typeof computer.internet !== "boolean") report("computer.internet", "is true or false: whether its programs may reach the internet.");
  if (computer.files === undefined) return;
  if (!computer.files || typeof computer.files !== "object" || Array.isArray(computer.files)) return report("computer.files", 'is { "name.py": "its text" }.');
  const entries = Object.entries(computer.files);
  if (entries.length > COMPUTER_FILES) report("computer.files", `at most ${COMPUTER_FILES} files.`);
  let chars = 0;
  for (const [name, text] of entries) {
    if (!COMPUTER_FILE.test(name)) report(`computer.files.${name}`, 'is named with letters, digits, _ . - and up to 3 folders, like "tests/check.py".');
    if (typeof text !== "string") report(`computer.files.${name}`, "is the file's text.");
    else chars += text.length;
  }
  if (chars > COMPUTER_CHARS) report("computer.files", `at most ${COMPUTER_CHARS} characters in all.`);
}
