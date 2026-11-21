# Work with Sedna mail

Once a home's owner or admin has connected Sedna ([Connect Sedna](connecting-sedna.md)) and a person is matched to
their Sedna user, that person's bots work in their own Sedna teams' shared email as them: they write and send
messages, keep drafts, tag messages and link job references, assign messages to colleagues, save attachments, use the
teams' templates and contacts, and run routines on new mail. This guide covers how a person does each, what asks
first, and what each refusal means.

Everything here happens in any chat the person asks in, as their own Sedna user and from one of their teams: the
cards are theirs alone to answer. A bot never sends or changes anything as a colleague, and never touches another
team's messages. What it reads and drafts in a chat can be seen by everyone who can open that chat.

## Write a message or a reply

1. In the bot's chat, ask: "Reply to Kim's fixture recap: owners accept 3 to 5 December", or "Write to
   ops@agency.example from Operations about the bunkers."
2. The bot shows a **draft card** headed **Sedna**: **From** names the person and the team ("Pat Doe · Chartering
   (Sedna)"), with **In reply to** for a reply, and **To**, **Cc**, subject and text the person can edit. Files the bot
   attached are under **Attached**.
3. The person edits it and selects **Send**. The card folds to "Sent from Sedna", and a line in the chat says what went
   where. **Discard** sends nothing.

A person with several teams is asked which one it comes from. A reply goes from the team the message came into.

**Replies and Sedna's threads.** Sedna's API can't answer a message inside its conversation. A reply goes out as a new
message to the sender, with "Re:" and their message quoted below, and Sedna may show it outside that conversation's
thread. The card says so. To keep it in the thread, the person answers in Sedna itself.

**Their own style.** If the person has a skill describing how they write (their own skill, under **Skills**), the bot
writes in it. Otherwise they can say how it should sound.

**Templates.** "Draft the fixture confirmation to owners@example.com from our template." The bot lists the team's
templates and starts the card from the one named: its subject and text, which the person can edit. A template's own
attachments aren't added.

**Attaching files.** "Attach the recap PDF from my files." Up to 5 files of the bot's, 10 MB each.

**Sending without a card.** "Send it" or "send Kim this: …" with the exact message counts as the person's OK, and the
bot sends it straight away. When the bot sends on its own idea, it asks first on an approval card. A person's own
**Always ask** rule makes it ask every time.

## Drafts kept in Sedna

The bot can also save a draft in the person's Sedna Drafts ("save that as a draft in Sedna"), change one of their own
drafts there, add files to it, and send it. It never changes or sends a colleague's draft, nor a message already sent.

## Sort: tags and job references

- "Tag this Fixtures", "take the Urgent tag off", "link it to VOY-123", "unlink it from VOY-123." Only the person's
  teams' tags and job references are used.
- A new job reference is made only when the person asks for one ("make a job reference VOY-303 and link it"). If one
  with that name is already there, the bot uses it.

Tags and links can be undone, so they don't ask first unless one of the person's rules says so.

## Assign a message to a colleague

"Assign this to Sam." Sedna tells Sam, so the bot asks first on an approval card unless the person said exactly that.
Only active colleagues in the message's team can be chosen; "me" is the person. Sedna's API can't take an assignment
off: the person does that in Sedna.

## Attachments

"Save the attachments of Kim's recap." The bot saves them into its files, under **Sedna** and the message's subject, up
to 10 files or 60 MB at a time; it says what's left. It can then read them or attach them to another message.

## Contacts

"What's Kim Broker's email?" reads the team's contacts. "Add Ana Test, ana@example.com, as a contact" or "change Kim's
title to Senior broker" changes them, only when the person asks. A change keeps everything else in the contact.

## Routines on new mail

"Every 15 minutes, tag new fixture recaps Fixtures, link them to their voyage, and draft a reply for me to check."

- Each run reads only what came into the person's teams since the last run, oldest first. Its first run starts from
  when the routine was made.
- A run looks at 10 messages at most; if more came in, it says so and the next run carries on. Nothing is skipped.
- It tags, links, writes replies as draft cards and posts a summary. It never sends or assigns by itself: those wait on
  a card, unless one of the person's rules allows them. It doesn't make job references or contacts.
- A run that fails reads the same mail again next time, so a message may be tagged or get a draft twice.

## Test copies

A copy of Mercbot that isn't live (Development, Test or Staging) changes nothing in Sedna, not even a tag: it makes
every check a live copy makes, then records what it would have done. Its cards fold to "Logged, not sent (test copy)".

## When something goes wrong

- **"… isn't in any of the person's Sedna teams."** The message is another team's: nothing of it is shown or changed.
- **"… isn't one of the person's Sedna teams (…)."** The person named a team they're not in. The bot asks which.
- **"Sedna doesn't say that draft is the person's own …"** It's a colleague's draft, or Sedna didn't say whose: finish
  it in Sedna.
- **"That message was already sent or received …"** Only unsent drafts are changed or sent.
- **"No Sedna tag called …" / "No Sedna job reference called …"** None of that name in the person's teams. The bot
  lists them.
- **"That tag isn't one of the person's teams' …"** It belongs to other teams only.
- **"A job reference is made only when the person asks for a new one …"** Ask for it in so many words.
- **"No active Sedna user called … is in the message's team."** The colleague is in another team or archived.
- **"Sedna's contacts are added or changed only when the person asks …"** Ask for it in so many words.
- **"… is N MB; attachments added from here are 10 MB at most."** Send it from Sedna, or a smaller copy.
- **"Sedna answered 500, so it isn't known whether the change was made."** or **"Sedna didn't answer."** after a send
  or change: it may have gone through. The bot never tries again by itself, and a draft card shows "It isn't known
  whether the last try went: check Sent in Sedna before you press Send again." Look in Sedna first.
- **"Sedna refused it (…): … Nothing was changed."** Sedna turned the change down and said why, for example a
  credential without MESSAGE_WRITE: an owner or admin gives the credential the permission in Sedna.
- **"Sedna is busy: try again in N s. Nothing was done."** Sedna asked Mercbot to wait, or the account's Request pace
  has no turn free just now: try after the wait it names. A list or a routine's run stops there rather than leave
  messages out, and the routine reads the same new mail on its next run. See
  [Choose how fast Mercbot uses an app](request-pace.md).
- **"A routine never sends a Sedna draft: the person presses Send on its card."** Sending is the person's.

## What Colleague can do

Colleague can explain these steps, open the bot's chat, and suggest how to ask. Sends, assignments and changes in
Sedna are the person's bot's, in the chat they asked in, through its cards: Colleague doesn't press Send or approve for
them.
