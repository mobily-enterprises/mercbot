import { serve } from "../server.js";

// Mercbot, as `npm start` (scripts/serve.sh) starts it: one person's own copy, behind the single-user gate (D-81),
// draining on SIGTERM or SIGINT (D-19). A copy built on Mercbot that serves many people replaces this file with one
// that passes `gate: false` (seam S1).
await serve();
