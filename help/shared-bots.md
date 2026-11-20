# Bots shared in a home

Everything in Mercbot lives in a home: its bots, their files and computers, and the people who use them. Everyone in a home works with the same bots, and everyone has their own chat with each of them. This page answers the questions that come up when bots are shared: who can use them, what each sharing mode adds, what stays private, how approvals work, and what owners and admins can control. It ends with a table of common problems.

## Who can use the bots in a home?

Everyone in the home. A home has three roles:

| Role | What they can do with bots |
| --- | --- |
| **Owner** | Everything: use every bot, choose who sees what, manage people and the home's accounts. There's one owner per home. |
| **Admin** | Choose who sees what, and connect accounts for the whole home. |
| **Member** | Use every bot in the home, create new bots, and organise their own sidebar. |

See [Homes: Mercbot for families and teams](/help/homes).

You can belong to several homes. The switcher at the top of the sidebar lists them, and you only see the bots of the home you're in. The first time you open a bot someone else made, it introduces itself to you.

## What are the sharing modes?

Everyone in a home has their own chat with every bot, which only they see. Each bot also has one of three modes, shown under **Who sees what** in its Details panel, and each mode adds something to those chats:

| Mode | What it adds |
| --- | --- |
| **Private** | Nothing more. The bot keeps nothing across people. |
| **Mixed** (the default) | A home notebook of things that help everyone, which everyone can read. |
| **Shared** | Conversations everyone in the home sees, as tabs. Each person's own chat is the last tab, **You only**. The notebook isn't used. |

Pick **Private** for a bot that handles personal matters, such as health or money. **Mixed** suits most bots: everyone has their own chat, and useful know-how builds up for the whole home. **Shared** suits a bot that works for a group, such as a family planner or a team's project helper, where everyone should see the same conversations, while each person can still talk with it on their own.

### How do I change a bot's mode?

1. Open the bot's Details panel (select its name at the top of the chat, or press **Ctrl+Alt+B**).
2. Choose an option under Who sees what.
3. Mercbot asks first, for example **Make Planner Shared?**, and says what changes and for whom. Select **Make it Shared** to go ahead, or **Cancel**.

Only the home's owners and admins can change it; everyone else sees the current choice and the note "The home's owners and admins choose this." Everyone in the home sees the change straight away.

In a home where you're the only person, the modes differ only by a notebook nobody else reads, so Who sees what shows only for a bot that isn't on Mixed, the default. That way you can always set it back.

### What a change does

- **Making a bot Shared** adds a tab called **General** and takes you to it. Everyone's own chat with the bot becomes their **You only** tab, with its messages, routines, files and computer as they were. A Mixed bot stops using the home's notebook; its notes are kept.
- **Making a Shared bot Private or Mixed** hides its shared tabs from everyone. They aren't deleted: they come back when the bot is Shared again. Each person's You only becomes their chat with the bot again.
- **Nothing runs in a hidden tab.** Its routines and watches pause, and the tab gets a line, **Paused while hidden**, naming them, so you can resume them there once the bot is Shared again. A long job still carrying on there stops at its next step, and search doesn't find what's in hidden tabs.

## How do a Shared bot's tabs work?

A Shared bot shows its conversations as tabs under its name at the top of the chat: **General** first, then the other shared tabs, and last **You only**, with a lock.

- **Everyone sees everything in a shared tab.** Every message shows who wrote it, and the bot reads each message with the writer's name. The message box says "Message *bot* · everyone in *home* sees this".
- **You only is yours.** The message box says "Message *bot* · only you see this", and pointing at the tab says "Only you see this conversation". See [Your own tab: You only](#your-own-tab-you-only).
- **Start a new conversation** with the **+** button beside the tabs. Give it a name and press Enter. Every tab must have a name, and every new tab is a shared one.
- **A new conversation continues from a shared tab.** Started from one, it knows everything said there up to that moment; anything said there afterwards doesn't flow into it. This lets you branch off: "Holiday 2027" can grow from "General" without cluttering it. Started from You only, it starts empty, so nothing of yours goes where others read. The **+** button's tooltip says which.
- **Rename a shared tab** by double-clicking it. You only can't be renamed.
- **Unread dots** on tabs show where there's something you haven't seen, You only included. Each tab is tracked on its own for each person, and the bot's dot in the sidebar shows while any of its tabs has news.
- **The bot's line in the sidebar** shows its latest reply in the shared tabs, whichever tab you have open. Its replies in You only don't show there.
- **Mercbot remembers your tab.** The bot opens on the tab you last had open.

If your home uses Apps and its Builder bot is Shared, the Builder keeps one conversation for each app. **Ask Builder** in an app opens that app's own tab, named after the app, whichever tab you had open. See [Build an app with the Builder](/help/apps-builder).

## Your own tab: You only

You only is your own chat with the bot: the same one you had before the bot was Shared, with its messages, routines, files and computer. Only you ever see it; the home's owners and admins can't read it either.

- **The bot works as in any private chat.** It uses what it remembers about you, your own connected accounts and the home's, your vault, your own skills, your folder with the bot and your own computer with it.
- **It knows the shared tabs by name only.** It never sees what's said in them, so if you need something from one, it suggests you look there.
- **Nothing goes out of it.** The bot notes nothing in a notebook and posts nothing into a shared tab, and a tab you start from here starts empty.
- **Asking another bot from here** lands in that bot's chat with you, never in one of its shared tabs. Asked from a shared tab, the other bot answers in one of its own shared tabs if it has them, else in its chat with you.

## What's private and what's shared?

This is the most important thing to understand about shared bots.

| | Your own chat with any bot, You only included | A Shared bot's shared tabs |
| --- | --- | --- |
| **Who sees it** | Only you. | Everyone in the home. |
| **What bots remember about you** | Used. | Never used. |
| **Your connected accounts** | Your own accounts and the home's. | Only the home's accounts. |
| **Your saved logins in the vault** | Used to sign in for you, without the bot ever seeing them. | Never used. |
| **Your own skills** | Used. | Not used. |
| **Files** | Your folder with the bot, the bot's folder for everyone using it, and the home's folder. | The bot's folder for everyone using it, and the home's folder. |
| **The bot's computer** | Your own, so your sign-ins never appear in anyone else's session. | One for each shared tab, used by everyone in it. |

In short, a shared tab never uses anything personal, because everyone would see it. If you need your own inbox, a remembered fact or a saved password, ask in your You only tab. The bot will suggest this itself.

### Files and the computer follow the tab

What a bot saves, and the computer it works on, belong to the tab it's in, not to the bot's mode. In a shared tab, what you attach and what the bot makes go in its folder for everyone using it, and the bot works on that tab's computer. In You only they go in your own folder, and it works on your own computer, as in any private chat.

A Shared bot's Details panel always shows all three folders under **Files**: **Just me**, **Everyone using** the bot, and the home's folder. Its **Computer** tab shows the computer of the tab you have open.

### What about the home's accounts?

Owners and admins can connect an account for the whole home, such as a family calendar or a team inbox, by choosing **Everyone in** the home when they add it in Connect apps. Everyone sees these accounts listed. Shared tabs use only these. See [The bots' computer and connected apps](/help/computer-and-apps).

### Is the home's shared folder private?

No. The shared folder is seen by everyone in the home and all its bots. Ask a bot to keep a file in its own folder if it shouldn't go further. See [Files, documents and pictures](/help/files).

## How does the home notebook work?

A Mixed bot keeps a notebook for the whole home. Private and Shared bots don't use it.

1. While you chat with the bot privately, it may learn something that helps everyone: "The boiler service is booked through the landlord", or "Invoices go out on the 1st."
2. It notes it and tells you in one line: **Noted for** your home, with an **Undo** button. Undo takes the note out, and the line then reads "Taken out of the notebook".
3. Everyone in the home can read the notebook in the bot's Details panel, with who it came from and when.

The bot never notes personal details, secrets or other people's information. It refuses email addresses, long numbers such as card or account numbers, and your saved passwords. It never reads other people's chats, only the notebook.

**Keep my chats out of it.** If you'd rather the bot didn't note anything from your chats, turn on the switch at the bottom of the notebook in the Details panel. This only affects your chats.

**Removing notes.** The person a note came from can remove it with the cross beside it, and so can the home's owners and admins.

## How do approvals work on a shared bot?

Bots ask before doing things that can't easily be undone, such as sending, buying, booking or posting. In a shared tab:

- The approval card, with **Go ahead** and **Don't do it**, appears in the conversation, so everyone in it can see it and answer it.
- The bot follows the approval rules of the person whose message it's answering. Rules are personal; each person sets their own in **Settings → Permissions**.
- An email draft card works the same way: everyone in the conversation sees it, with its **Send** and **Discard** buttons.

In your You only tab, cards are yours alone, as in any private chat.

Because everyone sees and can answer the cards in shared tabs, agree as a home on what a shared bot should and shouldn't do. See [Approvals, safety and privacy](/help/approvals-and-privacy).

## Can I use shared bots in a group chat?

Yes. You can start a group chat with up to six bots from your home, shared or not, and add people from your home to it. Only the people in a group see it. See [Messaging and working together](/help/messaging).

## Who can rename, delete or add bots?

- **Creating bots.** Anyone in the home can create a bot or add one from a template. It becomes part of the home.
- **Renaming.** Anyone can rename a bot, and the new name shows for everyone.
- **Template and additions.** Everyone can read a bot's template and additions in its Details panel, but only the person who made the bot and the home's owners and admins can change its template or its additions, there or, for the additions, by saying yes on the card the bot shows when asked to change them. Anyone else who asks is told politely that they can't.
- **Organising.** Pins, sections, hidden bots and unread marks are personal. Hiding a bot only hides it for you.
- **Deleting.** Anyone in the home can delete a bot other than the main bot. It's deleted for everyone, with all its conversations, so agree on it first.

### Whose spending is the work?

The home's, whoever's chat or conversation the work comes from. Owners and admins see the whole home's spending; members see their own use. See [Settings and notifications](/help/settings).

## What can owners and admins do?

On top of everything members can do, owners and admins can:

- choose each bot's mode under Who sees what;
- change any bot's template and additions, not only the ones they made;
- remove any note from a bot's home notebook;
- connect accounts for everyone in the home, and remove them;
- choose where the home keeps its files, in **Settings → Files**;
- set up apps from a bot template that comes with one.

Owners and admins can't read other people's own chats with any bot, You only tabs included.

## Troubleshooting

| Problem | Likely cause | What to do |
| --- | --- | --- |
| I can't find a bot someone told me about. | It's in another home, it's hidden in your sidebar, or it was deleted. | Check the home switcher at the top of the sidebar, look under Hidden bots, or search with Ctrl+K. |
| The Who sees what options are greyed out. | Only owners and admins can change them. | Ask an owner or admin of the home. |
| There's no Who sees what in the Details panel. | You're the only person in the home, and the bot is on Mixed. | Nothing to do: with nobody else in the home, the modes make no difference to anyone. |
| A bot's shared tabs have gone. | It isn't Shared any more, so they're hidden, not deleted. | Ask an owner or admin to make it Shared again. |
| A tab says **Paused while hidden**. | The bot stopped being Shared, which paused that tab's routines and watches. | Once it's Shared again, resume them in that tab. |
| A shared bot can't read my email or calendar. | Shared tabs use only the home's accounts. | Ask in your You only tab, or ask an owner or admin to connect a home account. |
| A shared bot doesn't know my allergy or preferences. | Memories are never used in shared tabs. | Mention what matters in the conversation, or ask in You only. |
| A shared bot won't use my saved password. | Vault logins are never used in shared tabs. | Ask in You only for sites that need your own login. |
| A skill I picked does nothing in a shared tab. | Your own skills aren't used there. | Use the skill in your You only tab. |
| A new tab doesn't know what was said later in General. | A new conversation only knows what came before it started. | Repeat the important points in the new tab, or carry on in the original. |
| A tab I started from You only knows nothing. | Tabs started from You only start empty, so nothing of yours goes where others read. | Tell it what it needs to know there. |
| I can't rename You only. | It's your own chat, and it keeps its name. | Rename the shared tabs instead. |
| Someone else's sign-in shows on a shared bot's computer. | A shared tab has one computer for everyone in it. | Sign in to personal sites only in your own chats, You only included. |
| A bot didn't note something for the home. | The bot isn't Mixed, your chats are kept out, or the note had details it won't keep. | Check Who sees what and the switch at the bottom of the notebook. |
| A note I added has gone from the notebook. | You, or an owner or admin, removed it. | Tell the bot again if it's still useful. |
| A bot's name changed. | Someone in the home renamed it. | Rename it back, or agree on names together. |
| I can't share a group chat. | Group chats are always personal. | Use a Shared bot for conversations everyone should see. |

## Related pages

- [Homes: Mercbot for families and teams](/help/homes)
- [Bots: create, shape, organise and remember](/help/bots)
- [Messaging and working together](/help/messaging)
- [Approvals, safety and privacy](/help/approvals-and-privacy)
- [The bots' computer and connected apps](/help/computer-and-apps)
- [Files, documents and pictures](/help/files)
