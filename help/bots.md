# Bots: create, shape, organise and remember

A bot in Mercbot is a helper with its own name, look, chat and computer. You give it work in plain words, and it gets on with it: looking things up, making documents, keeping an eye on a schedule, or working in its own browser while you're away. This page covers making bots, shaping them for a job, keeping the sidebar tidy, starting from a ready-made template, and what bots remember about you. It ends with advice on running several bots as a team.

## Give each bot a clear job

Bots work best when each one has one clear job. A bot called "Pantry" that plans meals and keeps the shopping list is easier to work with than one bot asked to do everything. Its chat stays on one subject, so it keeps the thread better.

Every bot follows one **template**, plus its own **additions**:

- **Its template** is its job: what it's for, how it goes about it, and its skills. A template comes from Mercbot's library, the [template gallery](/templates), or is one of your home's own. The bot never changes its template itself; the people who look after the bot can choose another one.
- **Its additions** are rules for that bot alone, on top of its template. Where the two differ, the template wins.

The template's tag shows beside the bot's name everywhere: in the sidebar, the chat header, pickers and search (**Ctrl+K** finds a bot by its tag too). A small cloud marks a template from Mercbot's library, a **+** after the tag means the bot has additions of its own, and hovering over the tag shows the template's line and the first line of the additions.

A bot you make with **New bot** starts as a **general** bot: Mercbot's all-round helper with no particular job. Write its job in its additions, in the Details panel (select the bot's name at the top of the chat). The bot reads its template and additions before every reply, in every conversation, for everyone who uses it. Say:

- **What it's for.** "You look after our family calendar and school letters."
- **Who it's for and how you like things.** "Keep replies short. I prefer lists."
- **Where it should stop and check.** "Never book anything without asking me first."
- **What a finished job looks like.** "Each Friday I want one summary with next week's events."

Keep additions to the rules that always apply. Because the bot reads them with every message, reference material, such as a price list, a manual or a book about your trade, belongs in its **Knowledge**, where a long piece is searched when it's needed (see [What a bot knows](#what-a-bot-knows)), and the steps of a job in a skill (see [Skills, routines and watches](/help/skills-and-routines)). Additions can be up to 20,000 characters, about ten pages.

You can also tell a bot in its chat how you'd like things done. It carries that through the conversation: however long the chat gets, it keeps a summary of the older part in the background (what you asked, what was decided, what it promised and what's still open) and reads everything since word for word. You don't need to repeat yourself. For something it should always do, ask it to add that to its additions. When you correct it the same way a second time, it offers to.

## Create a bot

1. Select **New bot** at the top of the sidebar, or press **Ctrl+Alt+N**. You can also type "New bot" in the search palette (**Ctrl+K**).
2. Under **What will it do?**, choose one:
   - **General helper**, first: an all-round bot that asks what you need.
   - One of your home's templates, listed next with how many bots use each.
   - One of Mercbot's templates, with the gallery's search, job areas and **Tested** badges.
   - **Add a team**, at the foot of the list: a few bots for one situation, made together. See [Add a team](#add-a-team).
   - **Make a new template**, at the bottom, when nothing fits. See [Make your home's own template](#make-your-home-s-own-template).
3. A template you choose is shown whole: its instructions and skills, and for one of Mercbot's its routines and apps too. Select **Next**, or **Back** to choose another.
4. Type a name in **What should your bot be called?** One of Mercbot's templates starts with its own name, cloud and colour, which you can change.
5. Pick a cloud. There are 28 clouds, from a plain cumulus to thunderstorms, snow, fog and rainbows, each with its own kind of eyes, plus Mercbot's own cloud that always comes in orange.
6. Pick a colour from the palette of 11. The dialog starts with a random choice, and the preview shows how the bot will look.
7. Select **Create**.

The new bot opens straight away. A General helper greets you and asks what it should help with first, usually as a question card you can answer with a click, or with your own words. A bot on a template greets you with its template's greeting and asks its setup questions.

A new bot starts in the home's mode for new bots: Mixed, unless the home's owners or admins chose otherwise (see [Homes](/help/homes)). A new Shared bot opens on your own **You only** tab, with its General tab beside it for everyone in the home.

Shape and colour are set when you create the bot, and the dialog starts with a colour and cloud your other bots don't have yet. Each bot's eyes show how it's doing: they glance around now and then, look up while it thinks, dart from side to side while it works, look down as it concentrates, and turn into happy smiles when it's done. The bot that builds your apps wears a propeller hat.

## Add a team

Pick what you need help with, and Mercbot adds a few bots that work well together, such as **Small shop** or **Busy household**, in their own section of your sidebar. Each is one of Mercbot's templates. A new home can come with one (see [Start with a team](/help/homes#start-with-a-team), with every team and its bots); **Add a team** adds one to the home you're in:

1. Select **New bot** and scroll to **Add a team**, at the foot of **What will it do?**.
2. Choose a team. Each one shows its bots' faces and how many there are.
3. The team's bots are listed with their name, look, tag and what they do, all ticked. Untick any you don't want. A bot whose template the home already has says **Already in this home** and isn't added again.
4. If a bot works with an app in Apps and you're an owner or admin of the home, a box under it sets up that app as a draft for you to review, as New bot does; untick it to leave the app out.
5. Select **Add N bots**. **Back** or the close button leaves without adding anything.

The bots are added together, all or none, in a sidebar section named after the team, in the team's order, and the first of them opens. Each starts in the home's mode for new bots and greets you with its template's greeting and setup questions when you open it; until you answer, none of them does any AI work. Anyone in a home can add a team.

## Edit and rename a bot

Open the Details panel by selecting the bot's name at the top of the chat, or press **Ctrl+Alt+B**. There you can:

- **Rename it.** Select the name, type a new one and press Enter. Escape cancels.
- **Read its instructions.** **Instructions** comes first on the **Details** tab; selecting the tag under the bot's name takes you there. One line says what the bot is, such as "This bot is a meals bot, plus its own additions." Then its template, which is read-only (marked with a lock): where it's from, with the day Mercbot last tested it for one of Mercbot's, what changed in it since the bot started to follow it, its instructions (**Show all** opens out long ones) and its skills.
- **Write its additions.** Select the box under **Additions · only this bot**, write or change them, and select **Save**, or **Cancel** to leave them as they were.
- **Change its template.** Select **Change template** under the template. See below.
- **Teach it.** Add text and files it should know, for everyone it talks with, under **Knowledge**, below Instructions. See [What a bot knows](#what-a-bot-knows).
- **Look after its routines.** Each routine has an on/off switch. Right-click one for **Pause** or **Resume**, **Edit** and **Delete**. See [Skills, routines and watches](/help/skills-and-routines).
- **Check its computer** on the **Computer** tab, browse its folders on the **Files** tab, and see what it made on the **Library** tab.

You can also rename a bot from the sidebar: right-click it and choose **Rename bot**.

Only the person who made the bot and the home's owners and admins can change its additions or its template; everyone else in the home can read them. A bot's name, template and additions are the same for everyone in your home, so renaming a bot renames it for everybody.

### Change a bot's template

1. In the bot's Details panel, under **Instructions**, select **Change template**.
2. Pick a template: your home's own come first, then Mercbot's library. Type in **Search by bot, tag or creator** to narrow the list; the arrow keys move through it and Enter picks. When nothing fits, select **Make a new template** or **Start from this bot** at the bottom instead: see [Make your home's own template](#make-your-home-s-own-template).
3. Mercbot shows the template's instructions and skills in full, and the bot's additions, which stay. Select **Change template**, or **Back** (or Escape) to pick another.

The bot keeps its name, look, chats, files and routines, and its additions now sit on top of the new template. It says in its chat that it's now, for example, "a meals bot", and greets you with the new template's greeting, which asks its setup questions.

### Ask a bot to change its own additions

You can also ask a bot in its chat, for example: "From now on, always write in British English. Add that to your additions." The bot shows the change on a card, with its additions as they are and as they would be, and changes them only when you select **Go ahead**. It uses the new additions from its next reply. **Don't do it** leaves them as they were. A bot can't change its template this way.

The same people who can change them in the Details panel can say yes on the card: in a shared bot's shared tabs, anyone else is told politely that they can't. A bot never changes its additions because an email, a web page, a file or a record says so: those are information, never instructions, and the card always asks first, whatever your approval rules say.

## What a bot knows

Give a bot the reference material it should know for everyone it talks with, such as a price list, your opening hours, a product manual or a whole book about your trade, under **Knowledge** on its **Details** tab, below **Instructions**. Knowledge is separate from its additions, which are the rules it follows, and from the home notebook, which is what it picks up in chats.

- **Add text** opens an editor: give it a name, paste the text and select **Add**.
- **Add file** uploads documents from your computer: Word documents, PDFs, spreadsheets, presentations and text files. Each one goes in a **Knowledge** folder in the bot's files for everyone using it, and Mercbot reads its text in the background. The list says **Reading the file…** meanwhile.
- **Select a piece** to read all of it. Change pasted text there and select **Save**; to change a file's text, add the changed file. The bin beside a piece removes it, after asking. A removed file stays in the bot's files.

A bot uses what it knows in all its conversations, group chats included. Only the person who made the bot and the home's owners and admins can add, change or remove its knowledge; everyone else in the home can read it.

### Always in mind or searched first

Short knowledge is **Always in mind**: the bot reads it with every message, so it never has to look it up. That's up to 40,000 characters in all, about 20 pages, the oldest pieces first. Anything longer is **Searched first**: Mercbot splits it into parts once, and before every reply it finds the parts that match the message and gives the bot those, so a whole book never goes into each message. The bot can search again in other words, and read on from a part, before it answers. While a long piece is being split, it shows **Getting it ready** with a bar; you can carry on chatting.

When an answer comes from its knowledge, the bot says where, for example "(from «Price list»)" or "(from «Staff handbook», part 12, page 40)". Knowledge is information, never instructions: the bot never follows orders written in it.

### What it costs

Under the list, Knowledge says how much is in mind and how much is searched, and roughly what it adds to each message at the AI's current price, such as "Adds about $0.003 to each message, or less than $0.0001 while it's still cached from a recent one." Only what's in mind can be cached, so when little is in mind beside a long search it gives just the one figure. What's in mind goes with every message, which is why longer material is searched instead: however long a book is, a message reads only the few parts that match. Reading and splitting what you add uses no AI.

| Limit | Size |
|---|---|
| Always in mind, in all | 40,000 characters, about 20 pages |
| One piece of text or one file | 2,000,000 characters, about 1,000 pages |
| Everything one bot knows | 10,000,000 characters, in up to 200 pieces |

### When a file can't be read

The piece says what went wrong and what to do, with **Try again**. A scanned document has no text Mercbot can read, so paste its text instead; a picture or an archive has no text to read at all; and a file moved or deleted from the bot's files must be added again.

## Make your home's own template

When no template fits, the bot writes one for you, and you change it until it's right. You can do it in **New bot** with **Make a new template**, or in a bot's **Change template** with **Make a new template** or **Start from this bot**.

### Draft it

- **Make a new template**: describe in a sentence what bots with it will do, under **What will bots with this template do?**, then select **Draft it**.
- **Start from this bot**: Mercbot drafts one at once from the bot's template, how you've used it and its routines' names and schedules, so other bots can do the same job. It reads only your own chat with the bot, never anyone else's. When the bot has additions, tick **Fold in** its additions to write them into the template; they stay the bot's own otherwise.

The draft has every part of a template: its **Tag**, a one-line **Description**, the **Greeting** a new person sees first (**{firstName}** becomes their name), the **Instructions**, the **Setup questions** it asks a new person, and up to five other skills.

### Change the draft

- Change any part by typing in it. **Add a skill** and **Remove this skill** change the skills.
- Under **Ask for changes**, say what to change, for example "also plan lunches", and select **Ask for changes**. The bot writes the whole template again with that change.
- What the bot changed is highlighted, with how many parts changed; in long parts the words added and taken out are marked.
- **Undo** goes back to the draft before, as many times as there were changes. The earlier drafts are kept only while the screen is open.

Each problem shows under its part, such as a tag another template has, or a greeting without **{firstName}**, and you can't save until they're put right.

### Save and use

- In **Change template**, **Save and use** keeps the template in your home and moves the bot onto it. With its additions folded in, the bot's own additions are emptied.
- In **New bot**, **Save and use** goes on to the bot's name, cloud and colour; **Create** saves the template and makes the bot on it.

Nothing is kept before you save: closing a draft you haven't saved asks first. Your home's owners and admins change or delete its templates later in **Settings** → **Templates**.

### What a draft costs

Each **Draft it**, **Start from this bot**, ticking **Fold in** and **Ask for changes** is one request to the AI, counted in **Settings** → **Spending** like a reply, for you, the home and, from a bot, that bot. If the bot's answer isn't a usable template, it's asked once more, which counts again; if that fails too, you see "Couldn't write a template from that. Try different words."

## Organise the sidebar

The sidebar lists your bots in three parts: pinned tiles at the top, then rows (grouped into your own sections if you have any), then **Hidden bots** at the bottom. Rows are sorted by latest activity, so the bot that last did something is at the top. A dot marks a bot with something you haven't read, and an unsent draft stays with each bot on your device.

Right-click a bot to:

| Action | What it does |
| --- | --- |
| **Pin** / **Unpin** | Shows the bot as a tile at the top. Drag tiles to change their order. |
| **Move to** | Puts the bot in one of your sections, or back in **Unassigned**. |
| **Move to new section** / **Create section** | Makes a new section with this bot in it. |
| **Mark as unread** / **Mark as read** | Flags a bot to come back to, or clears the flag. |
| **Hide from sidebar** | Moves the bot to Hidden bots. **Show in sidebar** brings it back. |
| **Delete** | Removes the bot, after you confirm. |

You can also drag a bot between sections. Right-click a section's name to **Rename** it, **Move up**, **Move down** or **Delete** it. Deleting a section doesn't delete its bots; they go back to Unassigned. Select a section's name to fold it away.

Pins, sections, hidden bots and unread marks are yours alone. Other people in your home organise their own sidebars.

To jump between bots, press **Ctrl+Alt+1** to **9** for the bots in sidebar order, **Alt+↑** and **Alt+↓** for the previous or next one, or **Ctrl+K** to search. Hidden bots still turn up when you search for them.

## Your main bot

Every home has one main bot, marked with a badge in the sidebar. It's the home's first bot: the one that introduces itself when a new home starts and asks for its name. Right after you name it, it asks "Will anyone else use this home with you?": **Just me** keeps the home's new bots Mixed, **Me and other people** makes them Shared. It doesn't ask when that was already chosen, for example under **Who's it for?** when the home was created. It's a good general helper and the natural place to start a new kind of job before you give it a bot of its own.

The main bot can't be deleted, so you always have someone to talk to. You can rename it, pin it, hide it or move it into a section like any other bot.

## Start from a bot template

Instead of shaping a bot from scratch, you can start from a template: a ready-made bot with one clear job, its own instructions and its own skills, and a one-word tag such as **meals** or **invoices**.

### The template gallery

The gallery at [/templates](/templates) is public, so you can browse it without signing in. It has:

- chips to show **All** templates or only those from the **Mercbot team**;
- a search box to **Search by bot, tag or creator**;
- a few featured templates, then a section for each job area: Home and family, Personal, Small business, Sales, Marketing, Hiring and people, Operations and finance, Engineering and product, and Design and writing. **View all** shows a whole area.

The gallery is curated: only the Mercbot team adds templates to it. Every template there starts by asking about you, and asks before it sends anything.

### Tested or not tested yet

Each template in the gallery, on its page and in New bot carries a badge:

- **Tested** with a date: on that day the Mercbot team checked the bot end to end. A new account added it, played its setup interview, and the check made sure it asked all its setup questions, created its routines paused and sent nothing without a yes.
- **Not tested yet**: it hasn't been checked that way, or it has changed since. A badge never outlives a change: when a template is edited, or Mercbot changes the way bots behave (the rules every bot follows, the way it works through a task, its setup questions, memories, skills and routines, what needs your yes and how things are sent, or the AI that runs chats), its badge goes back to Not tested yet until the check passes again.

Hover over the badge to see what it means.

### Look before you add

Select a template to open its page. It shows who made it, what it's for and its badge: **Tested** with the date, or **Not tested yet**. A menu shows everything the bot would be given:

- **Instructions**: what it's told to do.
- **Skills**: the playbooks it can run, with their full steps.
- **Routines**: jobs it would run on its own, and when.
- **Apps**: the connected apps it can use. These are all optional; it only uses them once you've connected them in Connect apps.

### Add the bot

1. Select **Add to Mercbot** on the template's page (or **Add** in the gallery). This opens the template's share page.
2. Select **Add to Mercbot** again. If you're not signed in, create an account or sign in, then come back to the link.
3. Mercbot opens **New bot** with that template chosen, showing the whole bot with its badge: its instructions, every skill's steps, its routines and its apps, all laid out. Read it through.
4. If the template is made to work with an app in Apps and you're an owner or admin of the home, you can tick the box to also set up that app as a draft for you to review.
5. Select **Next**, change the name, cloud or colour if you like, and select **Create**. **Back** or the close button leaves without adding anything.

Nothing is added until you select Create. The new bot joins your current home, follows the template with no additions yet, and opens with its own greeting. It then asks a few setup questions to learn your details. Any routines it suggests are created paused, and they only start when you say yes.

A bot a person shared with a link, rather than a template from the gallery, is added with **Add bot** under its preview, with the name and look they gave it. Its template becomes one of your home's own, tagged from its name, and the new bot follows it.

### Which template a bot follows

A bot's template is under **Instructions** in its Details panel: its tag, whether it's from Mercbot's library or your home's own, and, for one of Mercbot's, the day it was last tested. When Mercbot changes one of its templates, the panel says what changed and when, so if a bot ever behaves differently, you can see why.

## Delete a bot

Right-click the bot in the sidebar, choose **Delete** and confirm. The bot and its whole conversation are gone for good, so download anything you want to keep first.

Deleting a bot removes it for everyone in your home, not just for you. If you only want it out of your way, choose **Hide from sidebar** instead. The main bot can't be deleted.

Deleting a bot doesn't remove what your bots remember about you. Those facts stay in **Settings → Memory** until you remove them.

## Memory: what bots remember about you

Each bot's chat is private to it. But some facts are worth knowing everywhere: an allergy, a diet, a preference, an important date, the names of people close to you. When you tell a bot something like that, it saves it as a short sentence and says so in one line. From then on, all your bots in that home know it.

### What gets saved

- One lasting fact at a time, in plain words, such as "Sam is allergic to peanuts".
- Never passwords, card numbers or codes. Those belong in [the vault](/help/vault).
- Not which of your connected accounts to use. If you tell a bot "only use my work inbox", it keeps to that in its own chat, but your other bots don't inherit it.

Bots use what they remember. A bot planning a menu won't quietly swap away a remembered allergy or diet.

### See and correct memories

Open **Settings → Memory** (press **Ctrl+,** for Settings). It lists **What your bots remember about you**. Select the cross next to a fact to forget it.

You can also tell any bot "forget that I'm vegetarian", or correct it: "I'm not vegetarian any more." When a fact is no longer true, a bot can forget it.

If you have a lot of memories, bots read the 40 most recent each time.

### Who sees memories

Only you. Memories belong to you within one home: your bots in another home don't know them, and other people in your home never see them. A shared bot's shared tabs, which everyone in the home can read, don't use anyone's memories at all; its **You only** tab, your own chat with it, does.

### The home notebook

A bot set to **Mixed** (the usual setting) also keeps a notebook for the whole home; Private and Shared bots don't. When a chat teaches it something that helps everyone, such as "the bins go out on Tuesday nights", it notes it and says so in a line you can **Undo**. It never notes personal details, email addresses, long numbers or saved passwords. Everyone can read the notebook in the bot's Details panel, and you can keep your chats out of it. See [Bots shared in a home](/help/shared-bots).

### Why memory isn't a source of truth

Memory is a handful of short notes a bot chose to keep. It helps bots be thoughtful, but it isn't a record you should rely on:

- A note can be out of date if you didn't mention a change.
- It's a summary in the bot's words, not your own wording.
- Only the most recent notes are read each time.

Keep important information where it belongs: lists and records in [Apps](/help/apps), documents in the bot's files, and passwords and card details in the vault. Check Settings → Memory now and then, and remove anything that's no longer right.

## Run several bots as a team

As you add bots, think of them as a small team, each with its own job.

- **Hand work over.** Ask one bot to pass a job to another by name: "Ask Ledger to work out last month's totals." You'll see **Messaged Ledger** in the first chat. Ledger then does the job and answers in its own chat, which shows as unread.
- **Talk to several at once.** Start a group chat with up to six bots. They answer in turn, or only the ones you mention with @. See [Messaging and working together](/help/messaging).
- **Share files between them.** Ask a bot to put a file in the shared folder so your other bots can use it. See [Files, documents and pictures](/help/files).
- **Keep jobs apart.** If a bot's chat drifts into a second subject, start a new bot for it.

In a home with Apps, one bot is the **Builder**: the only bot that builds and changes apps. You'll know it by its thoughtful face. See [Build an app with the Builder](/help/apps-builder).

## Questions

### Can I change a bot's shape or colour later?

No. Shape and colour are chosen when you create it. You can change its name, template and additions at any time.

### Can I edit a template bot's instructions?

Its template stays as it is, but you can add to it, if you added the bot or you're an owner or admin of the home. Write your rules under **Additions** in its Details panel, or ask the bot to add them, which it does on a card you approve. Where your additions differ from the template, the template wins; to give a bot a different job, select **Change template**. A template of your home's own can be changed for every bot using it by an owner or admin, in **Settings** → **Templates**.

### Can I teach a bot a whole book?

Yes. Add it under **Knowledge** as a file, or paste its text, up to about 1,000 pages a piece. The bot searches it before every reply and says which part an answer came from, so you can turn a bot into an expert on your trade without making every message cost more.

### Do my bots read each other's chats?

No. Each bot's chat is private to it. Bots share only what you've asked them to remember, files in the shared folder, and work you hand from one to another.

## Related pages

- [Bots shared in a home](/help/shared-bots)
- [Messaging and working together](/help/messaging)
- [Files, documents and pictures](/help/files)
- [Skills, routines and watches](/help/skills-and-routines)
- [The vault: saved logins and secrets](/help/vault)
- [Homes: Mercbot for families and businesses](/help/homes)
- [Settings and notifications](/help/settings)
