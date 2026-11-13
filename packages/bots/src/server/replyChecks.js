// What a reply may claim (D-48): the words that say something happened, the notes, signed by Mercbot, that
// send a reply back once when its tools didn't do it, and passwords blanked from what a bot writes.
import { DRIVE_TOOLS } from "./driveTools.js";
import { GITHUB_CHANGES } from "./githubTools.js";
import { checkTexts } from "@jskit-ai/agent/server";

/** One plain line for the sidebar preview: markdown symbols and link targets removed. */
const opening = (text) => String(text).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/**
 * After a status line was posted, a short "I'll … now" lead in the reply says it a second time.
 * After a status line, a short one-sentence announcement of what the bot is about to do ("I'll
 * check both your calendars.") says it again, so it goes too.
 */
export function withoutRepeat(text, posted) {
  const [first, ...rest] = String(text || "").split(/\n\s*\n/u);
  const announces = /^(?:I'll|I will|Let me|First,? I'll)\b[^.!?\n]*[.!]?$/iu.test(first.trim()) ||
    /^(?:I'll|I will|Let me|On it|Sure)\b.*\bnow\b/iu.test(first.trim());
  const again = posted.some((line) => opening(line) && opening(first) === opening(line)) ||
    (posted.length > 0 && first.length < 120 && announces);
  return again && rest.length ? rest.join("\n\n") : text;
}

// A reply that speaks of pictures when none were made: always for the history note's wording, and
// otherwise when the person asked for a picture and the reply doesn't say it couldn't.
export const PICTURE_WORDS =
  /\b(?:pictures?|drawings?|illustrations?|artwork|paintings?|watercolou?rs?|cartoony|cartoons?|versions?|styles?|takes?)\b/iu;
const WANTS_PICTURE =
  /\b(?:draw|picture|illustrat\w*|paint\w*|sketch\w*|styles?|watercolou?r|cartoon\w*|photo|image|versions?|make (?:it|the|him|her))\b/iu;
export function claimsPicture(asked, reply) {
  if (/\(pictures? shown/iu.test(reply)) return true;
  return (
    WANTS_PICTURE.test(String(asked || "")) &&
    PICTURE_WORDS.test(reply) &&
    !/\b(?:can't|cannot|couldn't|unable|isn't switched on)\b/iu.test(reply)
  );
}
export const PICTURE_CHECK =
  "(Check from Mercbot: your reply talks about a picture, but you didn't call make_picture in this reply, so no picture is shown. If the person wants a picture, call make_picture now; otherwise answer again without saying a picture is shown.)";
// Saying no to a real person or a logo, then offering instead of drawing the alternative.
export const REFUSES_PICTURE = /\b(?:don't|do not|can't|cannot|won't)\b[^.\n]{0,60}\b(?:real,? (?:named )?(?:people|person)|logos?)\b/iu;
export const REFUSAL_CHECK =
  "(Check from Mercbot: you said you don't make that picture, but you didn't call make_picture with an alternative. Keep your one line saying no, and call make_picture now with an original alternative, without asking: for a person, only objects and symbols that suggest them, with no person or figure at all, not even a silhouette.)";
export const CALENDAR_ACTIONS = ["add_calendar_event", "change_calendar_event", "delete_calendar_event", "answer_invitation"];
export const DRIVE_ACTIONS = ["list_drive_files", "create_drive_document", "bin_drive_file", "save_to_drive", ...DRIVE_TOOLS];
export const CLAIMS_APPS = new RegExp(
  String.raw`\b(?:renamed|added|created|saved|updated|changed|marked|removed|` +
    String.raw`made)\b[^\n]{0,120}\b(?:fields?|tables?|apps?|drafts?|records?|labels?|` +
    String.raw`watch(?:es)?)\b|\bI(?:'m| am|'ll| will) (?:now )?(?:be )?(?:watching|` +
    String.raw`keeping an eye)\b`,
  "iu"
);
export const APPS_CHECK =
  "(Check from Mercbot: your reply says an app, table, field or record changed, but you didn't call any Apps tool in this reply, so nothing changed. Do it now with the right tool, or answer again without claiming it.)";
export const CLAIMS_DRIVE = new RegExp(
  String.raw`\b(?:Google Drive|OneDrive|your Drive|my Drive)\b[^\n]{0,160}\b(?:files?|docs?|` +
    String.raw`documents?|listed|below|under)\b|\b(?:files?|documents?)\b[^\n]{0,80}\b(?:in|` +
    String.raw`from) (?:your|my) (?:Google )?(?:Drive|OneDrive)\b`,
  "iu"
);
export const DRIVE_CHECK =
  "(Check from Mercbot: your reply talks about the person's Google Drive or OneDrive files, but you didn't call list_drive_files, create_drive_document or bin_drive_file in this reply, so nothing was read, made or moved there. Do it now with the right tool, or answer again without claiming it.)";
export const CLAIMS_CALENDAR = new RegExp(
  String.raw`\b(?:I've|I have|I|it's|it is|it's been|has been|is now)\s+(?:now\s+)?(?:added|` +
    String.raw`booked|put|scheduled|moved|changed|updated|removed|deleted|cancelled|accepted|` +
    String.raw`declined)\b[^.\n]{0,80}\b(?:calendars?|events?|invitations?|lunch|dinner|meeting|` +
    String.raw`appointment|booking|entry|reservation|call)\b|\b(?:Added|Removed|Moved|Changed|` +
    String.raw`Accepted|Declined)\s+["“][^"”\n]{1,200}["”]\s+(?:to|from|in|` +
    String.raw`on)\s+(?:Google Calendar|Outlook|your calendar)|\b(?:taken|is|it's|` +
    String.raw`now)\s+off\s+(?:your|the)\s+calendar\b`,
  "iu"
);
export const CLAIMS_MAIL = new RegExp(
  String.raw`\b(?:I've|I have|I|it's|it is|they're|they are|has been|have been|is now|` +
    String.raw`are now)\s+(?:now\s+)?(?:forwarded|archived|binned|moved|labell?ed|starred|flagged|` +
    String.raw`unstarred|deleted|marked)\b[^.\n]{0,80}\b(?:emails?|messages?|mails?|drafts?|inbox|` +
    String.raw`bin|trash|spam|junk|labels?|folders?|read|unread)\b|^(?:Forwarded|Archived|` +
    String.raw`Moved to the bin|Marked as spam|Deleted the draft|Saved a draft):`,
  "imu"
);
export const MAIL_CHECK =
  "(Check from Mercbot: your reply says mail was forwarded, sorted, labelled or a saved draft changed, but you didn't call forward_email, organise_email, mail_labels or mail_drafts in this reply, so nothing changed. Do it now with the right tool, or answer again without saying it's done.)";
export const GITHUB_WRITES = [...GITHUB_CHANGES, "github_comment"];
export const CLAIMS_GITHUB = new RegExp(
  String.raw`\b(?:I've|I have|I|it's|it is|has been|have been|is now)\s+(?:now\s+)?(?:opened|` +
    String.raw`created|merged|closed|reopened|approved|labell?ed|commented|released|published|made|` +
    String.raw`deleted|re-?ran)\b[^.\n]{0,80}\b(?:issues?|pull requests?|PRs?|branch(?:es)?|` +
    String.raw`labels?|releases?|reviews?|discussions?|runs?|workflows?)\b|^(?:Opened issue|` +
    String.raw`Merged pull request|Made the branch|Opened pull request|Approved|` +
    String.raw`Published release):?`,
  "imu"
);
export const GITHUB_CHECK =
  "(Check from Mercbot: your reply says something changed on GitHub, but you didn't call github_change, github_discussions or github_comment in this reply, so nothing changed. Do it now with the right tool, or answer again without saying it's done.)";
// A reply that ends by announcing its next step ("let me read the whole file") and stops there
// (D-47): the model sometimes ends its turn before the work, most often on the command line.
// The generic checks' notes, signed by Mercbot (D-48; @jskit-ai/agent).
export const CHECKS = checkTexts("Mercbot");
// Words that say files are attached, unless they say they aren't (D-48).
const CLAIMS_FILES = new RegExp(
  String.raw`\b(?:attached|attaching|file cards?|cards? (?:below|under)|here (?:they are|it is|` +
    String.raw`are the files)|I(?:'ve| have) (?:sent|attached|shared|uploaded) (?:it|them|` +
    String.raw`the files?|both|all))\b`,
  "iu"
);
const DENIES_FILES = /\b(?:not|n't|no|couldn't|can't|cannot|unable)\b[^.\n]{0,40}\b(?:attach|send|find|found|there)/iu;
/** `otherCard`: another kind of card shows under this reply, so "the card below" means that one. */
export const claimsFiles = (text, otherCard = false) => {
  const said = otherCard ? text.replace(/\bcards? (?:below|under)\b/giu, "") : text;
  return CLAIMS_FILES.test(said) && !DENIES_FILES.test(said);
};
/**
 * What every send-back ends with. A check only reads words, so it can be wrong: told to "do it now",
 * a bot that had only explained why it couldn't went and logged a made-up record.
 */
export const ONLY_WHAT_WAS_ASKED =
  "Do something only if the person really asked for it, with what they gave you. Never make up a record, event or message to make your words true. If nothing needs doing, just answer again, plainly. Write to the person as if this note didn't exist: never mention it, or apologise for what it asked about.";
export const FILES_CHECK =
  "(Check from Mercbot: your reply says files are attached, but no file card will show under it, because you haven't attached anything in this reply. Attach the existing files now with send_files (find their paths with list_files if needed), then reply naming them without their paths. If a file can't be found, say so plainly and offer the closest matches.)";
export const CALENDAR_CHECK =
  "(Check from Mercbot: your reply says you changed the calendar, but you didn't call add_calendar_event, change_calendar_event, delete_calendar_event or answer_invitation in this reply, so nothing changed. Do it now with the right tool, or answer again without saying it's done.)";
export const CLAIMS_HANDOVER = /\bscreen is (?:now )?yours|\bcard below|\bhand(?:ing|ed|s)?\b[^.\n]{0,40}\bscreen/iu;
export const HANDOVER_CHECK =
  "(Check from Mercbot: you told the person you're handing the screen over, but you didn't call ask_for_help, so there's no card and they can't reach your screen. Call ask_for_help now, opening the right page first if needed, or tell them plainly what you will do instead.)";

/**
 * Passwords a bot read somewhere (a page's printed demo login) are blanked too: in a
 * sentence about signing in, "password: X" and "name / X" keep the name and lose the password.
 */
export function blankPasswords(text) {
  return String(text).split(/(?<=[.!?])(?=\s)|(?<=\n)/u).map((sentence) => {
    if (!/pass(?:word|code)|sign(?:ed)? ?in|log(?:ged)? ?in|login|credentials/iu.test(sentence)) return sentence;
    return sentence
      .replace(/\b(pass(?:word|code)|pw)\b(\s*(?:is|was|:|=)\s*)[*_`"“']*[^\s*_`"”',.;)]+[*_`"”']*/giu, "$1$2•••")
      .replace(/([\w.@+-]{3,}[*_`]*\s*\/\s*)[*_`"“']*[^\s*_`"”',;)]{6,}?[*_`"”']*(?=[\s,;).]|$)/gu, "$1•••");
  }).join("");
}
