// Mentions in chats (D-112, R3; D-114): a mention of a bot of the chat makes it speak, and a mention of a person of the
// chat waits for them as the chat list's "@". Messages store a mention as a marker: <@bot:ID>, <@person:ID>, <@everyone>
// or <@app:ID>. The model reads and writes plain "@Name" instead.
const MARKER = /<@(bot|person|app|skill):([\w-]+)>|<@everyone>/gu;

export function mentionsIn(text) {
  return [...String(text || "").matchAll(/<@bot:(\d+)>/gu)].map((match) => match[1]);
}

/** The people a message's text mentions, by id, each once. */
function peopleMentionedIn(text) {
  return [...new Set([...String(text || "").matchAll(/<@person:(\d+)>/gu)].map((match) => match[1]))];
}

/**
 * The bots and people a message mentions, kept on the message so it reads right even after they change: `mentions` the
 * chat's bots it names, `mentionedPeople` the people of the chat it names (D-114). A marker naming anyone else stays in
 * the text and reads as "@someone".
 * @param {{ text?: string }} body
 * @param {Array<{ id: string, name: string }>} members the chat's bots
 * @param {Array<{ id: string, name: string }>} [people] the chat's people a message may mention
 */
export function withMentions(body, members = [], people = []) {
  const ids = mentionsIn(body.text);
  const mentions = members.filter((member) => ids.includes(member.id));
  const named = peopleMentionedIn(body.text);
  const mentionedPeople = people.filter((person) => named.includes(person.id));
  if (!mentions.length && !mentionedPeople.length) return body;
  return { ...body, ...(mentions.length ? { mentions } : {}), ...(mentionedPeople.length ? { mentionedPeople } : {}) };
}

/**
 * A message's people's markers as the model reads them (D-114): "@Name" from the names kept on the message
 * (`body.mentionedPeople`), "@someone" for any other; the other markers stay. The bots' turns (botAgent.contentOf) and
 * what the bots remember (records/roomsMemoryRepository.js) read a person's words through it.
 * @param {unknown} text
 * @param {Array<{ id: string, name: string }> | null | undefined} people
 */
export function peopleNamed(text, people) {
  return String(text || "").replace(/<@person:(\d+)>/gu, (marker, id) => `@${(people || []).find((entry) => entry.id === id)?.name || "someone"}`);
}

/** Markers as plain words for the model: bots named from `members`, people from `people` (each { id, name }). */
export function plainMentions(text, members = [], people = []) {
  return String(text || "").replace(MARKER, (marker, kind, id) => {
    if (!kind) return "@everyone";
    if (kind === "app") return `@${id}`;
    if (kind === "skill") return "/skill";
    const member = (kind === "person" ? people : members).find((entry) => entry.id === id);
    return member ? `@${member.name}` : "@someone";
  });
}

/** Text as it reads literally in a regular expression. */
export const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** The model's "@Name" for a member becomes that member's marker; longer names win. */
export function mentionMarkers(text, members = []) {
  let result = String(text || "");
  for (const member of [...members].sort((a, b) => b.name.length - a.name.length)) {
    result = result.replace(new RegExp(`@${escape(member.name)}(?![\\p{L}\\p{N}_])`, "gu"), `<@bot:${member.id}>`);
  }
  return result;
}
