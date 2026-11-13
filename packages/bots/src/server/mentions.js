// Mentions in group chats. Messages store a mention as a marker: <@bot:ID>,
// <@everyone> or <@app:ID>. The model reads and writes plain "@Name" instead.
const MARKER = /<@(bot|app|skill):([\w-]+)>|<@everyone>/gu;

export function mentionsIn(text) {
  return [...String(text || "").matchAll(/<@bot:(\d+)>/gu)].map((match) => match[1]);
}

/** The bots a message mentions, kept on the message so it reads right even after they change. */
export function withMentions(body, members = []) {
  const ids = mentionsIn(body.text);
  const mentions = members.filter((member) => ids.includes(member.id));
  return mentions.length ? { ...body, mentions } : body;
}

/** Markers as plain words for the model. */
export function plainMentions(text, members = []) {
  return String(text || "").replace(MARKER, (marker, kind, id) => {
    if (!kind) return "@everyone";
    if (kind === "app") return `@${id}`;
    if (kind === "skill") return "/skill";
    const member = members.find((entry) => entry.id === id);
    return member ? `@${member.name}` : "@someone";
  });
}

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** The model's "@Name" for a member becomes that member's marker; longer names win. */
export function mentionMarkers(text, members = []) {
  let result = String(text || "");
  for (const member of [...members].sort((a, b) => b.name.length - a.name.length)) {
    result = result.replace(new RegExp(`@${escape(member.name)}(?![\\p{L}\\p{N}_])`, "gu"), `<@bot:${member.id}>`);
  }
  return result;
}
