# The bots' computer and connected apps

Bots do much of their work in two places. The first is their computer: a small desktop with a web browser and office apps, where a bot can open websites, fill in forms and work on documents. You can watch it live, and take over when a step needs you. The second is your connected apps: Gmail, Outlook, Google Calendar, Google Drive, OneDrive, Google Contacts and GitHub, which bots reach directly once you've signed in to them in **Connect apps**. This page explains both: how the computer works, when it sleeps, what to do when a bot hands you the screen, and how to connect, check and limit your apps.

## The computer your bots use

Every bot has a computer. It's a small desktop that runs on Mercbot's servers, not on your device:

- a top bar with "Mercbot", the open windows and a clock;
- a dock in the middle with **Browser** and the office apps for documents, spreadsheets, slides and PDFs (right-click the desktop for the same list);
- windows that open full size, with red, yellow and green buttons on the left.

Who gets which computer depends on how the bot is shared in your home:

| Bot | Computer |
| --- | --- |
| Private or mixed bot | Each person has their own computer with the bot. Your browser sign-ins never show up for anyone else in the home. |
| Shared bot | Each conversation tab has one computer, used by everyone in that conversation. |
| Group chat | Groups have no computer of their own. Each bot uses its own. |

The computer can see the bot's folders: yours with the bot, the bot's for everyone using it, and your home's (see [Files, documents and pictures](/help/files)). Anything downloaded in its browser goes into your folder with the bot. When a bot makes a document, you can open it from the file viewer with **Edit on computer**. The file opens in its app on the bot's desktop, and you're put in control.

### What the computer is and isn't

- **It is** a real browser that keeps its sign-ins, so a bot can stay signed in to a website between tasks.
- **It is** a place where you and the bot can both work on the same screen.
- **It isn't** your own computer. It can't see your device's files, your other browser tabs or your passwords.
- **It isn't** a machine you install programs on, and it can't reach Mercbot's own folders.
- **It doesn't** do things only you can do, such as approving a sign-in on your phone, using a passkey or passing a bank's security check. The bot hands those steps to you.

## The command line

Every bot also has its own Linux command line, for work on files. Bots use it by themselves when a job calls for it; you just ask in plain words, for example "Make a GIF of the first five seconds of this video", "What does this scanned invoice say?" or "Give me monthly totals from this spreadsheet".

- **What's installed:** tools for video and audio, pictures, reading scanned pages (in English, French, German, Italian, Spanish and Portuguese), PDFs, converting documents, data and charts (Python with the usual data libraries), archives, programming (Node.js and Python, with git), and the office apps' own command-line versions.
- **What it can see:** only the bot's folders in that chat, and a scratch space. The scratch space is emptied after each command, or, while the bot's computer is awake, when the computer goes to sleep. It can't see Mercbot itself, other chats or other people's files. Files in the folders are never started as programs, even ones downloaded or uploaded; scripts are run through Python, Node or bash.
- **No internet:** commands can't reach the internet or install anything. To work on something from the web, the bot downloads it with its browser first.
- **Limits:** each command has limits on time, memory and file size. A command that takes more than two minutes carries on in the background, for up to 30 minutes, and the bot tells you when it's done.
- **You can see what it ran:** a line in the chat, such as "Ran 3 commands: Making the GIF", opens to show each command and its output.
- **The Terminal:** while the bot's computer is awake, the Terminal on its dock shows the bot's commands live in its top half. In the bottom half you can type your own commands, on the same folders, with the same tools and limits, and also without internet. Select **Take control** in the live view to type. A command the bot started keeps running if the computer goes to sleep.
- **Asked by another bot:** when one bot works for another, its commands can read but not change your own files or the home's.

## Coding with your own coding account

For coding work on a project in the bot's files, such as a website or an app in a folder, a bot can hand the job to a coding tool on its own computer: **Claude Code** or **Codex**. The tool works with your own account, never one Mercbot shares or sells, so what it uses is billed to that account by its maker, not by Mercbot. A bot hands work to it only when you ask in your own chat with it, never in a routine, a task from an app or a shared chat, so nobody else can spend your account.

1. **Connect your own coding account, once.** Ask the bot, or it offers when a coding job comes up. It opens the tool's sign-in in a window on its computer and posts a **Your turn** card. Select **Take over** and sign in with your own Claude (or ChatGPT) account. Codex also shows a code you can enter on your own phone or computer instead. Select **I'm done** when you've finished. The sign-in stays on that bot's computer, kept with its browser's sign-ins, where only the coding tool reads it; **Reset** in **Settings** removes it.
2. **Ask for the work.** The bot writes a brief (the problem, the outcome you want and anything not to change) and starts the tool in the project's folder. A **Claude Code started working** (or **Codex started working**) line opens to show the brief.
3. **Watch it if you like.** The tool works in a window on the bot's computer, so you can follow it in the live view.
4. **The bot reports.** When the tool finishes, the bot checks what changed in the folder and tells you what was done and what's left. The changes stay in the folder for you to review. The bot tells the tool not to push, merge, publish or delete anything, but it can reach the internet, so check what changed before you use it.

**What the tool can reach.** Each job, and each sign-in, runs in a fenced-in space of its own on the bot's computer, made for it and removed when it ends. The tool sees only the project's folder and its own sign-in: not the bot's other files, its browser or the sites you're signed in to there. It reaches the internet, to install packages or fetch a public repository, but never the bot's computer or Mercbot's servers.

One coding job runs at a time on each bot's computer, for up to two hours, and it's stopped if it uses more than 3 GB of memory. Ask the bot to stop it at any time. The computer stays awake while it works.

## Watch a bot work

You can see a bot's screen at any time, even while it's working.

1. Open the bot and open the **Details** panel (select the bot's name in the chat header).
2. Choose the **Computer** tab.
3. If the computer is asleep, select **The computer is sleeping. Click to wake it**. It shows **Starting up**, then a live picture of the screen.
4. Select the live picture (**Open**) for the full live view.

The live view shows the bot's whole desktop: its tabs, address bar and windows. At the bottom it says **Watching**, so you can follow along without getting in the way. Press **Escape** or select the collapse button at the top to close it. Closing the view doesn't stop the bot.

You don't need to watch to know what happened. When a bot has used its browser, its reply ends with a screenshot of each page it worked on. Select one to see it full size.

If the live view shows **Couldn't reach the screen**, select **Try again**. While the screen is still starting you'll see **Starting the desktop…** or **Connecting to the screen…** for a few seconds.

## Take control and hand-overs

### Take control yourself

In the live view, select **Take control**. The bottom bar changes to **You're driving**, and your mouse and keyboard now work on the bot's computer. When you've finished, select **Stop** or press **Escape** to go back to watching.

### When a bot hands you the screen

Some steps only you can do: signing in with a passkey, approving on your phone, a bank check, or entering card details at a checkout. When a bot reaches one, it opens the right page and posts a **Your turn** card in the chat, saying what to do and asking you to hand the screen back afterwards.

1. Select **Take over** on the card. The live view opens with you in control.
2. Do the step, for example sign in.
3. Select **I'm done**. The bot checks the page and carries on.

If you'd rather not do it, select **Skip**. The bot hears that and works out what to do next. Either way, the card folds away to a one-line note, such as "Done · Sign in to example.com".

While a hand-over is waiting, the bot's row in the sidebar turns amber and reads **Waiting for you:** followed by the task, so you can see it from any chat. The computer stays awake until you answer.

### Signing in to websites

Bots never ask for passwords, card numbers or codes in the chat. When a website needs a login, a bot tries these in order:

1. A login you gave it in your message for this task, such as a published test login.
2. A login saved in your vault for that site. Mercbot types it in; the bot never sees the password.
3. A secure form card in the chat, where you type the login (or a one-time code) yourself. Mercbot fills it into the page, and you can tick a box to save it to your vault.
4. Only then, a **Your turn** card so you can sign in on the screen yourself.

When a site emails you a sign-in or verification code, a bot signing in for you in your own chat can fetch it itself, as long as you've connected that mailbox (Gmail or Outlook). Mercbot looks only at mail that came in the last few minutes from the site the bot is signing in to: the bot never sees the code, and it never appears in the chat. A **Typed in the sign-in code from your email** line shows it happened. A home's shared mailbox is never used for this. If no code turns up, for example because the site sent it by text message, the bot posts a secure form for you to type it in. It does the same in a routine or a task from an app, which run while you're away.

The code goes in by itself only on the pages the sign-in you asked for leads to. The bot starts that sign-in from the site's front page, or from an address you give it, and follows the site's own redirects, forms and buttons from there, including windows it opens, such as **Sign in with Google**. That lasts until the sign-in is done, or 10 minutes, or until the bot opens another address itself. On any other page, even one on the same site, such as a form someone published on docs.google.com, and for a code from another site the sign-in passes through, such as Google's own, the bot asks first: a card asks *Shall I type the sign-in code from no-reply@example.com into this page?* with the page's full address under it. Check the address is the site you meant to sign in to before you press **Go ahead**. If the page has moved on by then, nothing is typed.

The vault and the secure form are explained in [The vault: saved logins and secrets](/help/vault).

### Paying

Bots stop before paying, ordering, booking, sending, cancelling, posting or inviting, and ask you first. Card details are only ever typed on the shop's own checkout page, by you, after the bot hands you the screen. See [Approvals, safety and privacy](/help/approvals-and-privacy) for how asking first works.

## Sleeping, waking and resetting

A computer wakes when a bot needs it, or when you wake it from the Computer tab. It goes to sleep after five minutes with nothing happening, unless someone is watching it or a hand-over is waiting. If it falls asleep while you have the live view open, it wakes again.

Sleeping doesn't lose anything. When a computer sleeps, its browser is saved, sign-ins included. When it wakes, the browser comes back as it was and reopens the last page. This works even if it wakes up on a different server.

Computers share the servers they run on. If every computer on a server is busy, waking one can take a little longer, and occasionally you'll see a message that all computers are in use and to try again in a moment.

A computer counts one day when it first starts each day (UTC), however often it wakes that day, and a command counts the time it runs. Both show in **Settings** > **Spending**, as **Computer days** and **Commands**, at no cost.

### Update and Reset

Open **Settings** > **Computer**:

- **Update** always shows **Up to date**. Your bots' browsers are kept up to date for you, and updating keeps their saved sign-ins.
- **Reset** starts every one of your bots' computers in this home afresh. Open pages close, and saved sign-ins and website data are cleared. Mercbot asks first. Your chats, routines and skills stay, and so does your vault. Computers in shared bots' conversation tabs aren't reset.

Reset is useful when a website is stuck in a strange state, or when you want a bot to forget every website it's signed in to.

## Connect apps

**Connect apps** is where you choose which outside apps your bots can use. Open it from the sidebar, or type "Connect Apps" in the search palette (**Ctrl+K**). On a phone it fills the screen.

The catalogue shows:

- **Recommended for you** at the top, then a section for each category.
- Category chips: **All**, **Password Managers**, **Productivity**, **Communication**, **Design** and **Code**, with **More** for Data, Sales, Marketing, Finance, Research and Support. **View all** opens a whole category.
- A search box, **Search apps and skills**, which finds apps by name or description.
- A summary at the top right, such as "3 connected", which opens **Your apps and skills**: the apps you've added with their state, and your private skills.
- **Bot templates**, which opens the template gallery in a new tab.

Each app has a small badge: **b** means built but not yet tested by hand, **✓** means tested, and **★** means it has worked well in everyday use.

Select an app to open its page. It shows a description, your accounts, the app's tools, and an Information table (capabilities, developer, category, website and availability). **Share** copies a link to the app, and **View source** shows the app's definition.

## Add an app and sign in

1. In Connect apps, select **Connect** next to the app (or open its page and select **Connect**).
2. A sign-in tab opens with the app's own sign-in page. Sign in and agree to what Mercbot asks for.
3. The tab says **Connected to Google** (or Microsoft, GitHub, Calendly, Notion or Todoist), and you can close it. Back in Connect apps, a note confirms the app is connected.

The app's maker handles your login on its own page, so Mercbot gets a key to act for you, never your password. Connect apps keeps checking for a few minutes while you sign in, so there's nothing to refresh.

A bot can also suggest an app. If you ask for something that needs an app you haven't connected, the bot posts a card for it in the chat. Its button explains what connecting means (nothing is changed or sent without your yes, and you can unlink it at any time), then takes you to the sign-in. As soon as you've signed in, the card shows **Connected** and the bot finishes the job it was waiting to do, by itself: there's no need to ask again. If the bot is busy with another of your messages, it finishes that first. It waits up to 30 minutes for you to finish signing in; if you cancel the sign-in, the card stays as it was, so you can select its button again.

If you run your own copy of Mercbot that's only reachable from your own machine, the sign-in may not be able to come back to Mercbot by itself. The app's page then shows a box: paste the whole address the sign-in tab ended on and select **Finish**.

### Just me, or everyone in the home

An account you connect is yours. Your bots use it in your own chats, and nobody else in the home can use it.

Owners and admins can also connect an account for the whole home, such as a family calendar or a team inbox:

1. On the app's page, select **+ Add another account** (or **+ Add an account for everyone in** your home, if you haven't added the app for yourself).
2. Type a label, such as "Family".
3. Choose **Everyone in** your home instead of **Just me**.
4. Select **Authorize** and sign in.

A home's account shows "Everyone in" the home's name, and who added it. Everyone in the home sees it listed. Members can see its status but can't change it.

Which accounts a bot uses depends on where it's working:

- **In your own chats** a bot can use your own accounts and the home's.
- **In a shared bot's conversation tabs** it uses only the home's accounts, because everyone in the conversation can see the results.

### More than one account

You can connect several accounts of the same app, such as a work and a personal Gmail. Select **+ Add another account**, type a label (for example "work"), and select **Authorize**. Account rows read "label · address". Select an account's name to rename it.

With several accounts, a bot reads all of them unless you name one, and groups its answer by account. You can name an account by its label, its address, or its app ("the Google one"). "My calendar" means your own address. When a bot has to choose one account for a change, it asks once and keeps to your answer in that chat.

## Account states

Each account on an app's page shows where it stands:

| State | What it means | What to do |
| --- | --- | --- |
| **Connected** | Bots can use the account. | Nothing. **Disconnect** stops it. |
| **Needs auth**, with **Sign in** | The account was added but hasn't been signed in yet. | Select **Sign in**. |
| **Needs auth**, with **Reconnect** | A sign-in was started but not finished. | Select **Reconnect** and finish signing in. |
| **Needs auth**, with **Retry** | The sign-in was cancelled or refused. | Select **Retry**. |
| **Needs more access**, with **Sign in again** | The account was connected before the app asked for more access. It still works with what it has. | Select **Sign in again** when convenient. |

**Your apps and skills** shows each app with its worst state, so an app that needs you stands out. Its button (**Sign in**, **Reconnect**, **Retry** or **Sign in again**) goes straight to the account that needs attention. Six apps show at first; **Show all** lists the rest.

If a sign-in is cancelled, the sign-in tab says **Nothing was connected**, and you can try again from Connect apps.

### Work accounts that need approval

Some organisations only let their staff connect apps that an administrator has approved. If that happens with a Microsoft or Google work or school account, the sign-in tab says **Your organisation needs to approve Mercbot**. You did nothing wrong.

1. Select **Copy the link** under **Approval link for your IT team**.
2. Send the link to your IT team.
3. Once they've approved Mercbot, select **Retry** or **Sign in** on the account and sign in again.

### Disconnect or remove

- **Disconnect** (after **Disconnect this account?**) signs the account out. It stays listed so you can sign in again later. For Calendly, Notion and Todoist it also withdraws Mercbot's access on the app's side.
- **Remove** takes an account off the list. You can remove one of your own accounts while it isn't connected and the app still has another. Owners and admins can remove a home's account; Mercbot asks **Remove it for everyone?** first.
- **Uninstall** on the app's page removes the app and your own accounts with it. The home's accounts for that app stay.

## Tools: a switch for each action

Once an app has a connected account, its page shows **Tools**, with a count such as "24 of 24 enabled". Open it to see every action bots can take with that app, each with its own switch. Gmail has 24 actions, Google Drive 19, OneDrive 16, Outlook 34 (mail, calendar and contacts) and GitHub 52. Calendly, Notion and Todoist list the actions the app itself offers, as it last described them, once someone has connected it.

Switch off anything you never want bots to do. For example, switch off **Send email** and **Forward email** in Gmail and keep **Write emails for you to send**, so your bots can prepare emails but never send them. A switched-off action is gone from your bots completely: they won't do it through the app, and they're told not to do it on the app's website either. If you ask for it, the bot tells you it's switched off in Connect apps.

Tool switches are yours. They apply to your bots' use of that app.

## What connected apps let bots do

Bots read freely. Changes that are easy to undo, such as sorting mail or saving a draft, go ahead. Anything that sends, shares, deletes or invites people goes ahead only when you asked for exactly that; otherwise the bot asks first, with **Go ahead** and **Don't do it**. Your own rules in **Settings** can change when bots ask. Each change leaves a line in the chat saying what was done.

### Mail: Gmail and Outlook

- Search mail and read messages or whole conversations.
- Write emails as a draft card in the chat. You can edit the text, then select **Send** or **Discard**. When the draft is from a connected mailbox, it's sent from that mailbox.
- Keep drafts saved in your mailbox: list, read, create, update, delete and send them.
- Forward mail.
- Sort mail: archive, move to the bin (or delete and restore in Outlook), mark as spam or junk, mark as read, star or flag, and add labels or categories. Each can be undone.
- Create, rename and delete labels (Gmail) or folders (Outlook), and see your send-as addresses and Gmail filters.

### Calendars: Google Calendar and Outlook

- List your calendars and whose they are, read events, and search events by words.
- See all the dates of a repeating event.
- Check when you're busy or free across every calendar.
- Create, update and delete events, and reply to invitations. Adding an event to your own calendar goes ahead; inviting people asks first unless you asked for it.

Bots use your calendar's own time zone, so Google and Outlook show the same times.

### Contacts: Google Contacts and Outlook

Bots look people up by name for an email address or phone number. They never change your contacts.

### Files: Google Drive and OneDrive

- List recent files, search, browse folders, and see a file's details and who it's shared with.
- Read a file's contents, or download or export a copy into the bot's files, where it appears as a file card.
- Create folders, files and documents, update them, move, rename and copy them.
- Share files, and (Google Drive) read, add and reply to comments. Sharing and comments ask first unless you asked for them.
- Move files to the bin. Bots never delete a file for good.
- Save a file a bot made into your drive.

Google Drive asks for access to your whole Drive, so bots can work with any of your files. A Drive connected before it asked for that shows **Needs more access**: until you sign in again, bots can only change files Mercbot made there.

### GitHub

- Search and read issues, pull requests, discussions, code, commits, repositories, users and organisations.
- Read repositories: branches, commits and comparisons, files and folders, tags, releases, collaborators, and automation runs with their logs.
- Read pull requests' changes and reviews.
- Make changes: comment, create and update issues and labels, add sub-issues, create, update, review and merge pull requests, create branches and releases, and re-run automation.

GitHub changes go ahead only when you asked for exactly that change; otherwise the bot asks first. Comments on issues and pull requests always ask.

### Calendly, Notion and Todoist

These apps bring their own actions: when a bot needs one, it reads what the app can do and the app's own advice, then uses it as your account.

- **Calendly:** see who booked and when you're free, share booking links and make one-off ones, and cancel meetings.
- **Notion:** search, read and update pages and databases, and add comments.
- **Todoist:** add, reschedule and complete tasks, review what's due, and comment.

Reading goes ahead. A change goes ahead only when you asked for exactly that and the app says it can't do lasting harm; anything that deletes, or that the app doesn't vouch for, asks first. If you withdraw Mercbot's access on the app's own site, the account shows **Sign in** again and the bot tells you plainly that it isn't connected any more.

## Apps on their way

The catalogue lists hundreds of apps, and most of them aren't connected to Mercbot yet. An app that's coming has a **Request** button that tells Mercbot you want it. It then reads **Requested**, and the app's page says **Coming soon**. That includes apps such as Slack and Bitwarden, which have a page of their own but can't be signed in to yet.

When a bot needs an app that isn't ready, it still shows you the app's card in the chat, with an **Ask for it** button, and offers to do the job on the app's website in its browser meanwhile.

Bitwarden, under **Password Managers**, isn't connectable yet. Until it is, save the logins you want bots to use in the vault.

## Questions

### Does my bot see my password when I connect an app?

No. You sign in on the app's own page, and Mercbot receives a key that lets your bots act for you. Your password never reaches Mercbot.

### Can other people in my home use my Gmail?

No. Accounts you connect with **Just me** are yours alone. Only accounts an owner or admin connects for **Everyone in** the home are used by everyone, and those are the only ones used in shared bots' conversation tabs.

### Why is my app showing "Needs more access"?

The app now asks for more than it did when you connected it. It keeps working with what it has. Select **Sign in again** to give it the rest.

### Can I use an app that isn't in the catalogue, or isn't ready yet?

Yes, through its website. Ask the bot to do the job and it'll use its browser, signing in with a saved login, the secure form, or by handing you the screen.

### Will closing the live view stop my bot?

No. The live view only shows the screen. The bot carries on, and you can open the view again from the Computer tab.

### Why did my bot's computer forget its sign-ins?

Someone selected **Reset** in **Settings** > **Computer**, which clears saved sign-ins and website data. Sleeping and updates keep them.

## Related pages

- [The vault: saved logins and secrets](/help/vault)
- [Approvals, safety and privacy](/help/approvals-and-privacy)
- [Files, documents and pictures](/help/files)
- [Skills, routines and watches](/help/skills-and-routines)
- [Bots shared in a home](/help/shared-bots)
- [Settings and notifications](/help/settings)
- [Fixing common problems](/help/troubleshooting)
