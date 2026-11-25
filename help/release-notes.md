# Release notes

What's new in Mercbot, newest first. To see which version you're using, open the account menu, choose **Help and support**, then **About Mercbot**. You can also ask any bot "What's new in Mercbot?"

## 25 November 2026

- **Watches that fire too often:** a watch that fires more than 30 times in an hour pauses itself. Its runs count, and so do the times it fired that are still waiting their turn. Its chat gets one line from Mercbot instead of a message from the bot: "The watch "New orders" fired more than 30 times in an hour, so Mercbot paused it. Changes made while it's paused aren't handled, even once it's resumed." A paused watch runs nothing, not even a run it was still waiting to start. Resume it with its switch, on the bot's card or in **Settings** > **Recurring tasks**, or ask the bot to.
- **Runs that only say the home is paused don't count:** **Recurring tasks** counts a routine's or a watch's run once its bot starts working. A run that only said your home's work is paused isn't counted, and isn't shown as its last run.
- **Private skills:** saving or deleting one of your private skills in **Connect apps** works again.
- **Connect apps keeps your change:** a private skill you delete or change while Connect apps is still loading its list stays deleted or changed.
- **The Terminal on a bot's computer:** a command's exit code, such as "(exit 0)", always shows after the command's output, never above it.

See [Skills, routines and watches](/help/skills-and-routines) and [The bots' computer and connected apps](/help/computer-and-apps).

## 24 November 2026

- **Recurring tasks:** **Settings** > **Recurring tasks** lists everything your home does by itself: every routine and watch in the chats you can open, and every app's job, grouped by bot. Each shows when it runs in words, its next and last run, whether it's paused or needs attention, and what it cost in the last 30 days. Pause, resume, edit or delete it from there, by the same rules as anywhere else. Owners and admins see every task's cost; members see their own. Each bot's card links to its own.

See [Settings](/help/settings#recurring-tasks).

## 23 November 2026

- **Shared tables:** bots keep their records in your home's tables, never in a spreadsheet unless you ask for one. Every home builds on a small set of shared tables (organisations, contacts, departments, to-do lists and to-dos, places, events, graphics and deals). A bot adds one the first time it needs it, saying so in a line, and asks before adding a field or an extension, a table that holds more about each record of another. Bot templates now keep their records in these tables too.
- **Contacts and To-dos** are ready in every home: Contacts for people and organisations, To-dos for named lists, departments, who does what, and what's overdue. The **CRM** template now builds on Contacts, keeping each contact's sales stage and next step beside it.
- **New kinds of field:** a person in your home, tags, a web address, long notes, a date and time, files and pictures. A record's files live in **Database files**, which anyone can open and copy from but nobody can move, rename or delete.
- **Links you can see:** each table shows what it links to, what links to it and what extends it, and each record shows its related records.

See [Your data: tables, fields and records](/help/apps-data).

## 22 November 2026

Version 0: chats are at the heart of Mercbot. Nothing made before version 0 was kept, so these notes start here.

- **Bots' common knowledge and Rooms memory:** what you ask a bot to tell every bot is now **Bots' common knowledge**, the home's, in **Settings**; each bot's card links to it. What a bot remembers of the Public rooms it's in is its **Rooms memory**. The home's **Main bot and Builder** are chosen in **Settings** too, and a bot's card shows a chip when it is one. A bot's card is shorter.
- **One file browser:** **Files** in the sidebar, a room's details and a bot's card all open the same browser, listing every place you can open on the left: this room, **Home files**, each bot's files and your rooms and chats. Every file and folder has **Copy to…** and **Move to…**, and you can drag a file onto a place (hold **Ctrl**, or **⌥** on a Mac, to copy). Copying or moving a file out of a private room or chat to a place more people can open asks first. The message box's **+** has **Add from files…**, which copies files from anywhere you can open into the chat and attaches them.

- **Rooms, People and Bots:** the sidebar has three sections. **Rooms** are shared places to talk: **+** makes one, Public or Private, with a name, and it starts with just you; Public rooms you aren't in show faded, and writing in one joins it. **People** opens your private chat with someone, and **Bots** your chat with a bot, each private to the two of you: nobody else opens it and no bot carries it into other chats. **Invite** brings people and bots into a Private room, **Invite a bot** a bot into a Public one, and a bot invited into a long room reads its last 30 messages until you ask it to read further back. The sidebar is compact: rows are one line, **Files** and **Apps** are buttons beside **Search**, and each section folds away. The Team page is gone; **Add bots** is the **+** beside **Bots**, and **A ready-made team** is now **A ready-made set**.
- **Bots are members of your home,** like its people. Select one to open their card: a bot's has its **Details** (instructions, Knowledge, Rooms memory, watches, routines and archiving), **Files**, **Library** and **Computer**.
- **Public by default, Private when you choose:** every new room is Public, so everyone in the home can open it. Choose **Private** when you make a room to keep it to its members: "Only its members can open it, and nothing in it reaches other chats." A room stays the kind it started as.
- **One rule for what bots use:** a bot in a chat uses only what everyone who can open that chat can also open. What a bot makes in a chat belongs to that chat, and its files go in the chat's own folder.
- **Each bot's computer in a chat** is listed in **Chat details** → **Computers** as, for example, "Chef's computer", says that it belongs to the chat and who can watch it and use what's signed in on it, and lists what's **Signed in on it**. Anyone who can open the chat can **Watch**, **Take over** and **Hand back**, and the chat shows a line for each take-over and hand-back.
- **The everyone chat:** in a home with other people, a chat for everyone in it, always first in each person's list.
- **Ask Builder** opens the app's own chat with the Builder, made the first time anyone asks.
- **Archiving a bot** means it has left the home: it stays in its chats, greyed out, and never answers, and whoever made it, or an owner or admin, can resume it from its card, under **Archived bots** in the sidebar.
- **Archiving a Public room** puts it away, read-only, for everyone in it, under **Archived chats**, and pauses its routines and watches. A Private room isn't archived: each of its members hides it for themselves.
- **Bots remember** the Public rooms they're in, the way a person in your home would, and bring them up in their other chats; every bot also reads the home's common knowledge, what people asked a bot to tell every bot. What's said in a Private room, or in your chat with a bot or a person, stays there. See [What bots remember](/help/memory).
- **People in chats:** type **@** to mention someone in the chat (their chat list shows **@** until they read it), react to other people's messages, and attach files, which go in the chat's own folder. In your chat with a bot, **Continue with others…** carries it on in a new room, starting from the bot's short note of it.
- **Bots join in when useful:** in a chat with several people, every bot reads every message and replies when it has something useful to say, such as when you answer its question without naming it; otherwise it stays quiet. It's on in every chat; its maker or an owner or admin can switch it off in **Chat details**, and then bots answer only when called.
- **Bots talk to each other in the chat:** a bot asks another bot that's in the chat by mentioning it with **@**, never privately, and that bot answers in the chat, where you can see it. After 5 replies between bots in a row they wait for you, and one says plainly what it needs ("We need you to go on: …"); anything anyone writes in the chat lets them carry on. In a room a bot's card started, the Builder (or the bot the brief is for) answers the brief by itself. A home whose owners haven't chosen a Builder has its main bot as its Builder.
- **Discuss with the bots:** in a chat with two or more bots, write a question and choose **+** → **Discuss with the bots**. The card says what it may cost; the bots talk it over a round at a time, each adding something new or passing, and you choose **One more round**, **Wrap up** or **Stop**.

See [Rooms, people and bots](/help/chats).

## Related pages

- [Welcome to Mercbot](/help/welcome)
- [Rooms, people and bots](/help/chats)
- [General questions and answers](/help/faq)
