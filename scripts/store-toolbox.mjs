// Makes the bots' toolbox from the host's read-only store (MERCBOT_TOOLBOX_STORE) in MERCBOT_TOOLBOX_DIR
// (packages/files/src/server/storeToolbox.js, imported by its package name, as an app holding Mercbot's packages only
// as installed ones reaches it). scripts/serve.sh runs it at every start on such a host. It stops the
// start, saying so, when bots' computers couldn't start with what the store has, as the hosting script does without
// Xvfb (D-68); without everything the command line needs, Mercbot starts without the command line and says what's missing.
// Usage: node scripts/store-toolbox.mjs
import { makeStoreToolbox } from "@local/files/server/storeToolbox";

let made;
try {
  made = makeStoreToolbox(process.env);
} catch (error) {
  console.error(`Mercbot can't make its bots' toolbox from this host's store. See README → Hosting requirements.\n${error.message}`);
  process.exit(1);
}
if (!made.computers) {
  console.error("This host's store lacks programs Mercbot's bots' computers need. See README → Hosting requirements.\n" +
    `Not found on PATH in ${process.env.MERCBOT_TOOLBOX_STORE}: ${made.missing.computers.join(", ")}`);
  process.exit(1);
}
console.log(`Toolbox made from the store: ${made.programs} programs, ${made.fonts} font folders, ${made.libraries} libraries${made.graphics ? " and Mesa's drivers" : ""}, in ${process.env.MERCBOT_TOOLBOX_DIR}.`);
if (!made.commandLine) {
  console.log(`Bots have no command line on this server: the store lacks ${made.missing.commandLine.join(", ")}.`);
}
if (!made.certificates) {
  console.log("Bots' commands can't check the certificates of https sites: MERCBOT_TOOLBOX_CERTIFICATES names no root " +
    "certificates in the store (nixpkgs' cacert).");
}
if (!made.loader) {
  console.log("The office apps, voice memos and coding tools can't start in this toolbox, as they're made for an ordinary " +
    `Linux system: the store lacks ${made.missing.loader.join(" and ")} on PATH.`);
}
