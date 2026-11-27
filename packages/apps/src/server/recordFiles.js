import { open } from "node:fs/promises";
import { isFileField } from "../shared/formulas.js";
import { fence, refuse } from "./visitorAccess.js";
import { GateError, STORED_FILE } from "./validate.js";

/** The pictures an image field takes, by the start of their bytes. */
function pictureKind(head) {
  const bytes = Buffer.from(head || []);
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** A table's live file or picture field, by its id or key, or undefined. */
const fileFieldOf = (table, fieldName) =>
  table.fields.find((entry) => !entry.obsolete && (entry.id === fieldName || entry.key === fieldName) && isFileField(entry));

/**
 * A record's files and pictures in the home's Database files (D-130): the gate stores one when a file or image field is
 * set (attachFile), and removes the file a change replaced or cleared once the change is in. The files themselves are
 * written by the files feature, which plugs in at start (`impl`: write, remove, real); without it, nothing is stored.
 * @param {object} dependencies
 * @param {() => { write: Function, remove: Function, real: Function } | null} dependencies.impl
 * @param {(ctx: object) => string} dependencies.homeOf
 * @param {Function} dependencies.tableFor the gate's table lookup
 * @param {Function} dependencies.get the gate's get, which holds a visitor to their rows and readable fields
 * @param {Function} dependencies.update the gate's update, which sets the field
 */
export function createRecordFiles({ impl, homeOf, tableFor, get, update }) {
  const files = () => {
    const given = impl();
    if (!given) throw new GateError(503, "Files can't be added right now.", { code: "apps_files_unavailable" });
    return given;
  };

  /**
   * Writes `upload` ({ source, name, type }, a file the caller may read) as `field`'s file of record `recordId`, and
   * answers the value the gate stores. A picture field takes only a picture, by its bytes.
   */
  async function store(ctx, table, recordId, field, upload) {
    let type = String(upload.type || "");
    if (field.type === "image") {
      const handle = await open(upload.source, "r");
      const head = Buffer.alloc(16);
      await handle.read(head, 0, 16, 0).finally(() => handle.close());
      type = pictureKind(head);
      if (!type) {
        throw new GateError(400, `${field.label}: must be a picture (PNG, JPEG, GIF or WebP).`, {
          code: "apps_image_not_picture",
          params: { field: field.label }
        });
      }
    }
    const at = { table: table.key, record: String(recordId), field: field.key };
    const written = await files().write(homeOf(ctx), at, upload.source, upload.name);
    return { ...written, type, [STORED_FILE]: true };
  }

  /** Files no record holds any more (replaced, cleared, or left by a change that failed): each removed, never refused. */
  async function removeAll(ctx, paths) {
    for (const path of paths.filter(Boolean)) {
      await files().remove(homeOf(ctx), path).catch((error) => console.warn(`Removing a record's old file failed; it stays in Database files: ${error?.message}`));
    }
  }

  /**
   * A record's file or picture (`upload`: { source, name, type }, a file the caller may read), written to Database files
   * and set in one change; a change that fails leaves no file. A member's or a bot's, and only on real records: a
   * draft's practice data takes no files. A visitor's only with `made` (D-140): the caller vouches the record is the one
   * their submission just made, and the field must be one their access lets them write when adding.
   */
  async function attach(ctx, tableIdOrKey, id, fieldName, upload, { made = false } = {}) {
    if (!made) refuse(ctx);
    if (ctx.practice) throw new GateError(409, "Files are added to real records, not to a draft's practice data.", { code: "apps_files_not_in_practice" });
    const { table } = await tableFor(tableIdOrKey, ctx.options, { forWrite: true });
    const field = fileFieldOf(table, fieldName);
    if (!field) {
      throw new GateError(400, `${table.label} has no file or picture field "${fieldName}".`, {
        code: "apps_record_field_unknown",
        params: { table: table.label, field: String(fieldName) }
      });
    }
    let writer = ctx;
    const access = fence(ctx, table, "create");
    if (access) {
      if (!access.write.has(field.id)) {
        throw new GateError(403, `Visitors can't add ${field.label} to ${table.label}.`, { code: "apps_public_forbidden", params: { table: table.label } });
      }
      // The record is theirs, just made: its file is set past the fence (a visitor doesn't change records), still as them.
      writer = { ...ctx, vouched: true };
    }
    const stored = await store(writer, table, id, field, upload);
    try {
      return await update(writer, table.id, id, { [field.id]: stored });
    } catch (error) {
      await removeAll(ctx, [stored.path]);
      throw error;
    }
  }

  /**
   * A record's file or picture to serve, by its record, never by a path: read through the gate, so a visitor gets one
   * only from a record and field the public app lets them read (D-66). Answers { real, name, type, size }.
   */
  async function fileOf(ctx, tableIdOrKey, id, fieldName) {
    const { table } = await tableFor(tableIdOrKey, ctx.options);
    const field = fileFieldOf(table, fieldName);
    const value = field ? (await get(ctx, table.id, id))[field.id] : null;
    if (!value?.path) throw new GateError(404, "That file isn't there.", { code: "apps_record_file_missing" });
    return { real: await files().real(homeOf(ctx), value.path), name: value.name, type: value.type, size: value.size };
  }

  return Object.freeze({
    removeAll,
    attach,
    fileOf
  });
}
