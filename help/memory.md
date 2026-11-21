# What bots remember

Your bots remember, the way a person in your home would. What's said in a Public chat is the whole home's, so each bot in it remembers it and can bring it up in its other chats. What's said in a Private chat stays behind glass: its bots read it there, and in chats of only some of the same people, and never in a chat with anyone else in it. This page explains what each bot remembers, where it uses it, the notes everyone in the home is told, and how to make a bot forget.

## What a bot remembers

Each bot keeps a memory of the **Public chats it's in**: what was decided, what people said about themselves, promises made and threads still open, each with the chat it came from and who said it. Mercbot writes it in the background, from the chats themselves, and keeps it up to date:

- soon after a lot has been said in the bot's Public chats since its memory was last made, but never more than every half an hour;
- otherwise once a day, if anything was said at all.

A bot's memory never holds a Private chat. It's the same in every chat the bot is in.

## What a bot reads when it answers

When you ask a bot something, it reads, besides the chat you're in:

- **Notes for everyone** in the home (see below), in every chat;
- **its memory** of the Public chats it's in;
- **what was said since**, in its other chats that this chat may read: the newest lines of each, newest chats first.

It can also search what was said with **recall**, in its own chats, in one chat by name, or in every chat this chat may read, the home's Public chats it isn't in too, and read more of one chat around a line it found.

A bot says where something came from ("Chiara said in Trip planning that…"), and brings up another chat only when it helps.

## Which chats a bot may read from here

The rule is the one every chat follows: **a bot in a chat uses only what everyone who can open that chat can also open.**

| You're in | The bot reads |
|---|---|
| A Public chat | Every Public chat in the home, never a Private one |
| A Private chat | Every Public chat, this chat, and other Private chats that all of this chat's members are in |
| A Private chat of just you and a bot | Every Public chat, and every Private chat you're in |

So in a Private chat with Ben, a bot can mention something from a Private chat of you, Ben and Carla, but never something from your Private chat with Carla, and never anything Private in a Public chat. This is enforced when Mercbot reads the chats, not by asking the bot to be careful.

## Notes for everyone

Some things everyone in the home and every bot should know from now on: a date, a decision, an allergy. Ask any bot to **tell everyone**, or say yes when a bot offers to:

1. The bot shows a card: "Shall I tell everyone in *your home* that? …", with the exact words.
2. Select **Go ahead**, or **Don't do it**. Only the person who asked can answer it.
3. Once you say yes, the chat says **Told everyone in *your home***, and every bot reads the note from its next reply, in every chat.

A note is the home's, even when you asked from a Private chat, so word it for everyone. A note never holds an email address, a phone or card number (nine or more digits) or a password: the bot refuses and asks you to leave it out.

## See and remove what's remembered

Open a bot's card (select it in **Team**, or under **Bots** in **Chat details**) and its **Details** tab. Under **Knowledge**:

- **Memory** shows what the bot remembers and when it was made. Select **Show all** to read all of it. Everyone in the home can read it, as everyone can open the Public chats it comes from.
- **Notes for everyone** lists the home's notes, newest first, each with who asked for it and through which bot. **Show older notes** reads further back.

The person who asked for a note, and the home's owners and admins, can remove it with its bin. Every bot stops reading it from its next reply.

## Make a bot forget

- **Delete a Public chat** (its maker, or an owner or admin, in **Chat details**): its bots forget it at once, and what they remember is made again from the chats that are left.
- **Leaving a chat, archiving it, or archiving a bot** keeps what the bots remember: like a person, a bot still knows what was said in a chat it has left. An archived bot remembers nothing new until it's back.

For something you don't want any bot to remember, start a **Private** chat. See [Chats and your team](/help/chats#public-and-private-chats).

## Questions

### Can a bot tell someone what I said in a Private chat?

Only in a chat whose people are all in that Private chat too, such as your chat alone with a bot: never in a Public chat, and never in a chat with someone who isn't in yours.

### Why doesn't a bot know what I said a minute ago in another chat?

Its memory is made in the background. What came after it is in "what was said since", for chats this chat may read; a bot can also search for it with recall.

### Does remembering cost anything?

Making a bot's memory is AI work, counted in **Spending** as the bot's, for the home, not for any person.

## Related pages

- [Chats and your team](/help/chats)
- [Bots: add, shape and archive](/help/bots)
- [Approvals, safety and privacy](/help/approvals-and-privacy)
- [Settings and notifications](/help/settings)
