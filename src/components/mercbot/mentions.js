// Mentions in a chat: a message stores <@bot:ID>, <@person:ID>, <@everyone> or <@app:ID>, and keeps the mentioned bots
// in body.mentions and the people in body.mentionedPeople (D-114) so they read right later.
// A skill picked with "/" is stored as <@skill:ID> with its name in body.skills.
const MARKER = /<@bot:(\d+)>|<@everyone>|<@app:([\w-]+)>|<@skill:([\w-]+)>|<@person:(\d+)>/gu;

// The text in pieces: plain strings and mention tokens (`person` one of `people`, body.mentionedPeople).
export function mentionParts(text, mentions = [], skills = [], people = []) {
  const parts = [];
  let at = 0;
  for (const match of String(text || "").matchAll(MARKER)) {
    if (match.index > at) parts.push({ text: text.slice(at, match.index) });
    if (match[1]) {
      const bot = mentions.find((entry) => entry.id === match[1]);
      parts.push(bot ? { bot } : { text: "@someone" });
    } else if (match[4]) {
      const person = people.find((entry) => entry.id === match[4]);
      parts.push(person ? { person } : { text: "@someone" });
    } else if (match[2]) parts.push({ app: match[2] });
    else if (match[3]) parts.push({ skill: skills.find((entry) => entry.id === match[3])?.name || "skill" });
    else parts.push({ everyone: true });
    at = match.index + match[0].length;
  }
  if (at < String(text || "").length) parts.push({ text: text.slice(at) });
  return parts;
}

export function plainMentions(text, mentions = [], skills = [], people = []) {
  const plain = (part) => (part.bot ? `@${part.bot.name}` : part.person ? `@${part.person.name}` : part.app ? `@${part.app}` : part.skill ? `/${part.skill}` : "@everyone");
  return mentionParts(text, mentions, skills, people).map((part) => part.text ?? plain(part)).join("");
}
