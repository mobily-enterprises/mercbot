// A small YAML view of an app definition (read-only, D-35): what the Builder wrote, easy to read.
const plain = /^[A-Za-z_][\w .-]*$/u;
const scalar = (value) => {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = String(value);
  return plain.test(text) && !/^(true|false|null|yes|no)$/iu.test(text) ? text : JSON.stringify(text);
};

export function toYaml(value, indent = "") {
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return value.map((item) => {
      if (item && typeof item === "object") {
        const inner = toYaml(item, `${indent}  `);
        return `${indent}- ${inner.trimStart()}`;
      }
      return `${indent}- ${scalar(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value);
    if (!keys.length) return "{}";
    return keys.map((key) => {
      const item = value[key];
      if (item && typeof item === "object" && (Array.isArray(item) ? item.length : Object.keys(item).length)) {
        return `${indent}${scalar(key)}:\n${toYaml(item, `${indent}  `)}`;
      }
      return `${indent}${scalar(key)}: ${item && typeof item === "object" ? (Array.isArray(item) ? "[]" : "{}") : scalar(item)}`;
    }).join("\n");
  }
  return `${indent}${scalar(value)}`;
}
