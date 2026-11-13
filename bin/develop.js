import { develop } from "../server/lib/develop.js";

// Mercbot in development (`npm run develop`, Preview): one person's own copy, behind the single-user gate (D-81). A
// copy built on Mercbot that serves many people replaces this file with one that passes `gate: false` (seam S1).
await develop();
