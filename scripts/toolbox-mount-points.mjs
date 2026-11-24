// Makes the sandboxes' mount points (TOOLBOX_MOUNT_POINTS, packages/files/src/server/gvisor.js) in the toolbox at the
// folder given (makeMountPoints, storeToolbox.js, imported by its package name as scripts/store-toolbox.mjs does).
// scripts/build-toolbox.sh runs it on a toolbox it builds and on one it already has, so no sandbox needs gVisor to
// make one in a toolbox its user can't write, such as root's for a host's servers to share.
// Usage: node scripts/toolbox-mount-points.mjs <toolbox folder>
import { makeMountPoints } from "@local/files/server/storeToolbox";

const root = process.argv[2];
if (!root) {
  console.error("Name the toolbox folder: node scripts/toolbox-mount-points.mjs <toolbox folder>");
  process.exit(2);
}
makeMountPoints(root);
