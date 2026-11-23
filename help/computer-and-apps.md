# The bots' computer and connected apps

Bots do much of their work in two places. The first is their computer: a small desktop with a web browser and office apps, where a bot can open websites, fill in forms and work on documents. You can watch it live, and take over when a step needs you. The second is your connected apps: Gmail, Outlook, Google Calendar, Google Drive, OneDrive, Google Contacts and GitHub, which bots reach directly once you've signed in to them in **Connect apps**. This page explains both: how the computer works, when it sleeps, what to do when a bot hands you the screen, and how to connect, check and limit your apps.

## The computer your bots use

In each chat, every bot has its own computer, labelled with its name, such as "Chef's computer". It's a small desktop that runs on Mercbot's servers, not on your device:

- a top bar with "Mercbot", the open windows and a clock;
- a dock in the middle with **Browser** and the office apps for documents, spreadsheets, slides and PDFs (right-click the desktop for the same list);
- windows that open full size, with red, yellow and green buttons on the left.

A bot's computer belongs to the chat it's in. Everyone who can open the chat can watch it, take it over and use what's signed in on it, and the computer says so: "It belongs to this chat. The chat is public, so everyone in *your home* can watch it and use what's signed in on it.", or in a Private chat "It belongs to this chat. Only the chat's members can watch it and use what's signed in on it." In a chat with several bots, each one's computer is listed separately; a bot's computers in other chats are separate machines, with sign-ins of their own.

The computer can see the chat's folder, the bot's own folder and your home's (see [Files, documents and pictures](/help/files)). Anything downloaded in its browser goes into the chat's folder. When a bot makes a document, you can open it from the file viewer with **Edit on computer**. The file opens in its app on the bot's desktop, and you're put in control.

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
- **The internet:** commands reach public websites and services, as the browser does: for example to copy a public project from GitHub, download a file or install a package the job needs. They never reach private networks, Mercbot's own servers or email servers. Anything a command installs lasts only for that command; what it saves in the folders stays.
- **Limits:** each command has limits on time, memory and file size. A command that takes more than two minutes carries on in the background, for up to 30 minutes, and the bot tells you when it's done.
- **You can see what it ran:** a line in the chat, such as "Ran 3 commands: Making the GIF", opens to show each command and its output.
- **The Terminal:** while the bot's computer is awake, the Terminal on its dock shows the bot's commands live in its top half. In the bottom half you can type your own commands, on the same folders, with the same tools, internet and limits. Select **Take over** in the live view to type. A command the bot started keeps running if the computer goes to sleep.
- **Asked by another bot:** when one bot works for another, its commands can read but not change the chat's files or the home's.

## Coding with your own coding account

For coding work on a project in the chat's files, such as a website or an app in a folder, a bot can hand the job to a coding tool on its own computer: **Claude Code** or **Codex**. The tool works with your own account, never one Mercbot shares or sells, so what it uses is billed to that account by its maker, not by Mercbot. A bot hands work to it only when you ask, in any chat, never in a routine, a task from an app or work another bot asked for. The tool is signed in on the bot's computer in that chat, so everyone who can open the chat can use it: sign in from a Private chat with just you and the bot to keep it yours alone.

1. **Connect your own coding account, once.** Ask the bot, or it offers when a coding job comes up. It opens the tool's sign-in in a window on its computer and posts a **Your turn** card. Select **Take over** and sign in with your own Claude (or ChatGPT) account. Codex also shows a code you can enter on your own phone or computer instead. Select **I'm done** when you've finished. The sign-in stays on that bot's computer in this chat, kept with its browser's sign-ins, where only the coding tool reads it, and it's listed under **Signed in on it** as the tool's name followed by "(coding)".
2. **Ask for the work.** The bot writes a brief (the problem, the outcome you want and anything not to change) and starts the tool in the project's folder. A **Claude Code started working** (or **Codex started working**) line opens to show the brief.
3. **Watch it if you like.** The tool works in a window on the bot's computer, so you can follow it in the live view.
4. **The bot reports.** When the tool finishes, the bot checks what changed in the folder and tells you what was done and what's left. The changes stay in the folder for you to review. The bot tells the tool not to push, merge, publish or delete anything, but it can reach the internet, so check what changed before you use it.

**What the tool can reach.** Each job, and each sign-in, runs in a fenced-in space of its own on the bot's computer, made for it and removed when it ends. The tool sees only the project's folder and its own sign-in: not the bot's other files, its browser or the sites you're signed in to there. It reaches the internet, to install packages or fetch a public repository, but never the bot's computer or Mercbot's servers.

One coding job runs at a time on each bot's computer, for up to two hours, and it's stopped if it uses more than 3 GB of memory. Ask the bot to stop it at any time. The computer stays awake while it works.

## Watch a bot work

You can see a bot's screen at any time, even while it's working.

1. Select the chat's name at the top of the chat (or press **Ctrl+Alt+B**) to open its details, then the **Computers** tab. In your chat with one bot, it's the **Computer** tab of the bot's card.
2. Each bot's computer is listed by name, such as "Chef's computer", with whether it's **Asleep** or **Awake**, who has control, if anyone, and what's **Signed in on it**.
3. Select **Watch** for the live view. An asleep computer wakes for it: you'll see **Starting the desktop…**, then the screen.

The live view shows the bot's whole desktop: its tabs, address bar and windows, with the computer's name and the line saying who can use it at the top. At the bottom it says **Watching**, so you can follow along without getting in the way. Press **Escape** or select the collapse button at the top to close it. Closing the view doesn't stop the bot.

You don't need to watch to know what happened. When a bot has used its browser, its reply ends with a screenshot of each page it worked on. Select one to see it full size.

If the live view shows **Couldn't reach the screen**, select **Try again**. While the screen is still starting you'll see **Starting the desktop…** or **Connecting to the screen…** for a few seconds.

## Take control and hand-overs

### Take over yourself

Select **Take over**, on the bot's computer in the chat's details or at the bottom of the live view. The bottom bar says "You have control. Chef waits until you hand it back.", and your mouse and keyboard now work on the bot's computer. Anyone who can open the chat can take over. While you have control, the bot doesn't act on that computer: if it tries, it's told who has control and waits. When you've finished, select **Hand back** or press **Escape**.

The chat shows a line when someone takes over ("Anna took over Chef's computer.") and when they hand back ("Anna handed Chef's computer back."). While someone else has control, the chat's details say so, for example "Anna has control of Chef's computer. You can still take it over, or hand it back to Chef." You can take it over from them ("Ben took over Chef's computer from Anna."), hand it back to the bot, or just watch.

### When a bot hands you the screen

Some steps only you can do: signing in with a passkey, approving on your phone, a bank check, or entering card details at a checkout. When a bot reaches one, it opens the right page and posts a **Your turn** card in the chat, labelled with its computer ("Chef's computer"), saying what to do and asking you to hand the screen back afterwards. The card is for the person whose message started the work; others in the chat see "Waiting for Anna".

1. Select **Take over** on the card. The live view opens with you in control.
2. Do the step, for example sign in.
3. Select **I'm done**. The bot checks the page and carries on.

If you'd rather not do it, select **Skip**. The bot hears that and works out what to do next. Either way, the card folds away to a one-line note, such as "Done · Sign in to example.com".

While a hand-over is waiting, the chat's row in the sidebar turns amber and reads **Waiting for you:** followed by the task, so you can see it from any chat. The computer stays awake until you answer.

### Signing in to websites

Bots never ask for passwords, card numbers or codes in the chat. When a website needs a login, a bot tries these in order:

1. A login you gave it in your message for this task, such as a published test login.
2. A login saved in the home's vault for that site. Mercbot types it in; the bot never sees the password.
3. A secure form card in the chat, where you type the login (or a one-time code) yourself. Mercbot fills it into the page, and you can tick a box to save it to the home's vault.
4. Only then, a **Your turn** card so you can sign in on the screen yourself.

Once it's signed in, the bot says so in one line: "Everyone who can open this chat can use this sign-in." The sign-in stays on that computer, in this chat.

When a site emails you a sign-in or verification code, a bot signing in for you can fetch it itself, in any chat you ask in, as long as you've connected that mailbox (Gmail or Outlook). Mercbot looks only at mail that came in the last few minutes from the site the bot is signing in to: the bot never sees the code, and it never appears in the chat. A **Typed in the sign-in code from your email** line shows it happened. Only mailboxes you connected are used for this, never one someone else in the home connected. If no code turns up, for example because the site sent it by text message, the bot posts a secure form for you to type it in. It does the same in a routine or a task from an app, which run while you're away.

The code goes in by itself only on the pages the sign-in you asked for leads to. The bot starts that sign-in from the site's front page, or from an address you give it, and follows the site's own redirects, forms and buttons from there, including windows it opens, such as **Sign in with Google**. That lasts until the sign-in is done, or 10 minutes, or until the bot opens another address itself. On any other page, even one on the same site, such as a form someone published on docs.google.com, and for a code from another site the sign-in passes through, such as Google's own, the bot asks first: a card asks *Shall I type the sign-in code from no-reply@example.com into this page?* with the page's full address under it. Check the address is the site you meant to sign in to before you press **Go ahead**. If the page has moved on by then, nothing is typed.

The vault and the secure form are explained in [The vault: saved logins and secrets](/help/vault).

### Paying

Bots stop before paying, ordering, booking, sending, cancelling, posting or inviting, and ask you first. Card details are only ever typed on the shop's own checkout page, by you, after the bot hands you the screen. See [Approvals, safety and privacy](/help/approvals-and-privacy) for how asking first works.

## Sleeping, waking and resetting

A computer wakes when a bot needs it, or when you watch it or take it over. It goes to sleep after five minutes with nothing happening, unless someone is watching it or a hand-over is waiting. If it falls asleep while you have the live view open, it wakes again.

Sleeping doesn't lose anything. When a computer sleeps, its browser is saved, sign-ins included. When it wakes, the browser comes back as it was and reopens the last page. This works even if it wakes up on a different server.

Computers share the servers they run on. If every computer on a server is busy, waking one can take a little longer, and occasionally you'll see a message that all computers are in use and to try again in a moment.

A computer counts one day when it first starts each day (UTC), however often it wakes that day, and a command counts the time it runs. Both show in **Settings** > **Spending**, as **Computer days** and **Commands**, at no cost.

### Update and Reset

Open **Settings** > **Computer**:

- **Update** always shows **Up to date**. Your bots' browsers are kept up to date for you, and updating keeps their saved sign-ins.
- **Reset** starts afresh the bots' computers in the chats of this home where you're the only person. Open pages close, and saved sign-ins and website data are cleared. Mercbot asks first. A chat with other people keeps its computers, because they're theirs too. Your chats, routines and skills stay, and so does the vault.

Reset is useful when a website is stuck in a strange state, or when you want a bot to forget every website it's signed in to.

A single chat's computers have their own **Reset**, under **Computers** in **Chat details**. The person who started the chat and the home's owners and admins can reset them, and in your chat with one bot, you can.

## Connect apps

**Connect apps** is where you choose which outside apps your home's bots can use. Apps and accounts you add belong to the home you're in: everyone in it, and their bots, can use them. Open it from the sidebar, or type "Connect Apps" in the search palette (**Ctrl+K**). On a phone it fills the screen. **Skills**, the book beside it in the sidebar, opens it straight on your private skills.

The catalogue shows:

- **Recommended for you** at the top, then a section for each category.
- Category chips: **All**, **Password Managers**, **Productivity**, **Communication**, **Design** and **Code**, with **More** for Data, Sales, Marketing, Finance, Research and Support. **View all** opens a whole category.
- A search box, **Search apps and skills**, which finds apps by name or description.
- A summary at the top right, such as "3 connected", which opens **Your apps and skills**: the apps added to the home with their state, and your private skills.
- **Bot templates**, which opens the template gallery in a new tab.

Each app has a small badge: **b** means built but not yet tested by hand, **✓** means tested, and **★** means it has worked well in everyday use.

Select an app to open its page. It shows a description, the home's accounts, the app's tools, **What your bots learn** from it, and an Information table (capabilities, developer, category, website and availability). **Share** copies a link to the app, and **View source** shows the app's definition.

## Add an app and sign in

Only one button signs you in: **Sign in with Google** (or Microsoft, GitHub, or the app's name), and it says what happens next. Every other button just takes you there.

1. In Connect apps, select **Add** next to the app, or open its page and select **Add to this home**. The app is added and the **Add account** step opens.
2. Type a **Label** if you like, such as "Work". It's optional: without one, the account shows its address.
3. Read who will use it: for example **Everyone in Smith family, and their bots, can read and send from the account you connect.** Connect an account only if you're happy to share it in this home (see below).
4. Select **Sign in with Google** (or the app's own). On a computer, a small window opens with the app's own sign-in page; on a phone, the sign-in takes the page and brings you back. Pick the account, sign in and agree to what Mercbot asks for.
5. The window says **Connected to Google** (or Microsoft, GitHub, Calendly, Notion or Todoist) and closes by itself. Back in Connect apps, the account shows **Connected** and a note confirms it.

If the window stays open, for example because you closed Mercbot meanwhile, select **Close**. If your browser won't let the page close its own window, it says **You can close this tab now**. The small **Back to Mercbot** link under it opens Mercbot.

To add another account of the same app later, open the app's page and select **+ Add account**.

The app's maker handles your login on its own page, so Mercbot gets a key to act for you, never your password. Connect apps keeps checking for a few minutes while you sign in, so there's nothing to refresh.

Finish the sign-in in the browser you started it in, within 15 minutes. A sign-in belongs to that browser: if the app's page sends another browser back to Mercbot, such as one you copied the sign-in page's address into or someone you sent it to, the page says **This sign-in was started in another browser, so nothing was connected**, and nothing is. Start again from Connect apps in the browser you sign in with.

A bot can also suggest an app. If you ask for something that needs an app you haven't connected, the bot posts a card for it in the chat. Its **Connect** button explains what connecting means (nothing is changed or sent without a yes on its card first, and the account can be removed at any time) and shows the same **Add account** step, whose **Sign in with Google** (or the app's own) signs you in. As soon as you've signed in, the card shows **Connected** and the bot finishes the job it was waiting to do, by itself: there's no need to ask again. If the bot is busy with another of your messages, it finishes that first. It waits up to 30 minutes for you to finish signing in; if you cancel the sign-in, the card stays as it was, so you can select its button again.

If you run your own copy of Mercbot that's only reachable from your own machine, the sign-in may not be able to come back to Mercbot by itself. The app's page then shows a box: paste the whole address the sign-in page ended on and select **Finish**.

### Apps connected with API credentials: Sedna

Some apps have no sign-in for other apps. Sedna, the shared email for shipping teams, connects with API credentials that an admin of your Sedna organisation makes, and they're the whole home's: only the home's owners and admins connect it.

1. In Sedna, an admin opens **Settings**, then **API Credential Management**, and makes a credential. Note its client ID and secret. Give it these permissions to read: COMPANY_READ, USER_READ, TEAM_READ, MESSAGE_READ, EVENT_READ, CATEGORYTAG_READ, JOBREFERENCE_READ, COMMENT_READ, DOCUMENT_READ, TEMPLATE_READ and CONTACT_READ; and to change things: MESSAGE_WRITE, MESSAGE_DELETE, JOBREFERENCE_WRITE and CONTACT_WRITE. For reading only, the first ones are enough. If that page isn't there, your Sedna plan may not include the API: ask Sedna's support.

   If another program of yours already uses Sedna's API with a **username and password** (Sedna calls that Basic auth), that pair is one of these credentials: paste its username as the **Client ID** and its password as the **Client secret**. Mercbot first asks Sedna for a key with them; if Sedna gives none, it uses them as a username and password, as your other program does.
2. In Connect apps, open **Sedna** and select **Add to this home**. A form opens on the page instead of a sign-in window.
3. Type your **Sedna address** (the first part of the address you open Sedna at, the *acme* of acme.sednanetwork.com), the **Client ID** and the **Client secret**, and select **Save**. Once you've typed the address, the form also links to your Sedna's API Credential Management page.

Mercbot checks the credentials with Sedna before keeping them: a wrong ID or secret is refused in the form, and nothing is saved. Once they're accepted, the account shows your company's name and **Connected**, and a note says how many of the home's people Sedna knows by their email address. **Change credentials** enters new ones; the bin on its line (after **Remove it for everyone in** your home?) deletes them from Mercbot, with who each person is in Sedna.

**Who you are in Sedna.** The credentials read the whole organisation, so a bot reads only what *your* Sedna teams see. Mercbot finds you by your email address. If no Sedna user has it, Sedna's page shows **Who you are in Sedna**: type your name, find yourself and select **This is me**. An owner or admin confirms it under **People** (an owner's or admin's own choice counts at once). Until then your bots read nothing in Sedna. Nobody can choose a Sedna user that someone else in the home already is.

### Everyone in the home uses its accounts

Every account connected in a home is the home's. Everyone in the home, and every bot there, can use it, in any chat, Public or Private. Each account's line says so in plain words, such as **Everyone in Smith family, and their bots, can read and send from pat@example.com.** for a mailbox, then who added it (**Added by Pat.**, or **Added by you.**).

- **Sending stays clear.** A draft card shows which mailbox the email goes from, and it's answered like any other card: only by the person whose message started the work (see [Approval cards](/help/approvals-and-privacy#approval-cards)).
- **Sign-in codes stay with whoever connected the mailbox.** When a bot reads a mailbox someone else connected, Mercbot hides the sign-in codes and sign-in links in it, so a bot sees them only when the person who connected it is the one asking. This is worked out from the wording of each email, so now and then it hides a code that isn't a sign-in code, such as a discount code.
- **Who can change an account.** The person who added it and the home's owners and admins can rename it, sign it in again, choose its pace and remove it. Everyone else sees its status.
- **Your accounts go with you.** If you're no longer in a home, for example because an owner or admin removed you, the accounts you connected there are signed out and removed, and the **Activity** tab in **Apps** says so. Your accounts in your other homes stay.

To keep an account to yourself, connect it in a home only you are in, such as the one Mercbot made for you.

Sedna works in any chat, always as the asking person's own Sedna user: its API credentials could read the whole organisation, so a bot reads only your own Sedna teams.

### More than one account

You can connect several accounts of the same app, such as a work and a personal Gmail. Select **+ Add account**, type a label if you like (for example "work"), and select **Sign in with Google** (or the app's own). Account lines read "label · address", or just the address. Select an account's name to rename it.

With several accounts, a bot reads all of them unless you name one, and groups its answer by account. You can name an account by its label, its address, or its app ("the Google one"). "My calendar" means the account with your own address. When a bot has to choose one account for a change, it asks once and keeps to your answer in that chat.

### Request pace: how fast Mercbot uses an app

Every app limits how many requests it takes from one account, and Mercbot keeps each connected account to a share of that limit, from all your bots and routines together. An app's page shows **Request pace** with three choices for each connected account:

- **Gentle** (the default, for every account until someone changes it) uses a tenth of what the app allows. Keep it when other programs use the same account, such as your Sedna organisation's other integrations.
- **Normal** uses four tenths.
- **Fast** uses nine tenths: close to the app's limit, never over it.

The person who added an account and the home's owners and admins choose its pace. Sedna, for example, allows 100 requests a second: Gentle sends at most 10.

If an app asks Mercbot to wait, Mercbot sends that account nothing until the wait is over, and a bot or card says, for example, **Sedna is busy: try again in 30 s. Nothing was done.** It says the same when the account's pace has no turn free in the next 20 seconds because your bots already used it. Try again after the time it names. A routine that meets a busy app reads the same new mail on its next run, so nothing is skipped.

## Account states

Each account on an app's page shows where it stands:

| State | What it means | What to do |
| --- | --- | --- |
| **Connected** | Bots can use the account. | Nothing. The bin removes it. |
| **Needs sign-in**, with **Sign in again** | The account's sign-in has lapsed, or the app stopped accepting it. | Select **Sign in again** and pick the same account. |
| **Needs sign-in**, with **Sign in** | The account was added but hasn't been signed in yet. | Select **Sign in**. |
| **Needs sign-in**, with **Reconnect** | A sign-in was started but not finished. | Select **Reconnect** and finish signing in. |
| **Needs sign-in**, with **Retry** | The sign-in was cancelled or refused. | Select **Retry**. |
| **Needs more access**, with **Sign in again** | The account was connected before the app asked for more access. It still works with what it has. | Select **Sign in again** when convenient. |

**Your apps and skills** shows each app with its worst state, such as **Needs sign-in** or **No account yet**, so an app that needs you stands out. Select it to open its page, where the account's button is. Six apps show at first; **Show all** lists the rest.

Signing an account in again keeps it the same account. The app's sign-in page suggests the account's own address and lets you pick. If you sign in as a different address, nothing changes, and the page says so: to connect that one, use **+ Add account**.

If a sign-in is cancelled or doesn't work, the page says **Couldn't connect** and why. **Try again** starts the same sign-in again. Never sign in from a link someone else sent you to connect an app: it would connect your account to theirs, and Mercbot refuses it.

### Work accounts that need approval

Some organisations only let their staff connect apps that an administrator has approved. If that happens with a Microsoft or Google work or school account, the sign-in page says **Your organisation needs to approve Mercbot**. You did nothing wrong.

1. Select **Copy the link** under **Approval link for your IT department**.
2. Send the link to your IT department.
3. Once they've approved Mercbot, select **Retry** or **Sign in** on the account's line and sign in again.

### Remove an account or an app

- **The bin** on an account's line removes that account, connected or not, the first and the only one too. Mercbot asks first (**Remove it for everyone in** *home*? **Their bots stop using it.**), then deletes its key. For Calendly, Notion and Todoist it also withdraws Mercbot's access on the app's side. The person who added the account and the home's owners and admins see the bin. Removing an app's last account keeps the app in the home.
- **Remove from this home** on the app's page removes the app and all the home's accounts of it, after asking (**Remove Gmail from** *home*, **with its account? Everyone's bots stop using it.**). Owners and admins can always do it; the person who added the app can while every account of it is one they added. You can add it again any time.

To stop bots doing just one thing with an app, switch that action off under **Tools** instead.

## Tools: a switch for each action

Once an app has a connected account, its page shows **Tools**, with a count such as "24 of 24 enabled". Open it to see every action bots can take with that app, each with its own switch. Gmail has 24 actions, Google Drive 19, OneDrive 16, Outlook 34 (mail, calendar and contacts) and GitHub 52. Calendly, Notion and Todoist list the actions the app itself offers, as it last described them, once someone has connected it.

Switch off anything you never want bots to do. For example, switch off **Send email** and **Forward email** in Gmail and keep **Write emails for you to send**, so your bots can prepare emails but never send them. A switched-off action is gone from your bots completely: they won't do it through the app, and they're told not to do it on the app's website either. If you ask for it, the bot tells you it's switched off in Connect apps.

Tool switches are the home's: they apply to every bot in the home, in every chat. Only the home's owners and admins can switch an action off or on; everyone else sees the switches.

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
- Read a file's contents, or download or export a copy into the chat's folder, under **Drive**, where it appears as a file card.
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

### Sedna

Bots work in your own Sedna teams' shared email, as you: the Sedna user with your email address, or the one you picked and an owner or admin confirmed.

- **Read:** the newest messages that came into your teams ("anything new from the brokers today?"), messages with a tag or linked to a job reference such as a voyage or deal number, and one message: who sent it to whom, its text, tags and job references, who it's assigned to, your team's comments and its attachments. Lists of tags, job references, your teams, contacts and templates.
- **Write a message or a reply:** the bot shows it on a draft card, from you and one of your teams, with To, Cc, subject and text you can edit. **Send** sends it from Sedna. It can start from one of your teams' templates, and attach files from the chat's folder. Ask the bot to write in your own style if you've set one up.
- **Replies:** Sedna's API can't answer a message inside its conversation, so a reply goes out as a new message to the sender, with "Re:" and their message quoted below. Sedna may show it outside that conversation's thread. The card says so.
- **Drafts in Sedna:** the bot can also save a draft in your Sedna Drafts, change one of your own drafts, add files to it and send it.
- **Sort:** add or remove tags, and link or unlink job references. A new job reference is made only when you ask for one.
- **Assign** a message to a colleague in its team. Sedna tells them, so the bot asks first unless you asked for exactly that. Sedna's API can't take an assignment off: do that in Sedna.
- **Attachments:** save one or all of a message's attachments into the chat's folder, under **Sedna**.
- **Contacts:** add a contact or change one, only when you ask.

Everything happens as your own Sedna user, only on your own teams' messages, in whatever chat you ask in; everyone who can open that chat sees what the bot reads and drafts there. Sending and assigning reach other people, so they ask first unless you asked for exactly that; see [What always asks first](/help/approvals-and-privacy#what-always-asks-first). A copy of Mercbot that isn't live (Development, Test or Staging) changes nothing in Sedna: it logs what it would have done. Sedna has no search across message text: bots find messages by tag, by job reference or among the newest. Mercbot keeps to Sedna's [Request pace](#request-pace-how-fast-mercbot-uses-an-app), and if Sedna asks it to wait, the bot says when to try again.

If Sedna doesn't answer a send or a change, the bot never tries again by itself: it may have gone through. The card or the bot says so: look in Sedna first, then try again if it isn't there. Message comments are read only, because Sedna's API can't add them.

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

### Can a bot work on my project on GitHub?

Yes, for a public repository: the bot copies it to the chat's folder from its command line, makes and tests the changes there, and gives you the changed files or a patch. It can't send the changes back to GitHub itself: its command line has no GitHub sign-in, and the GitHub connection reads repositories and manages issues and pull requests but doesn't change their files.

### Does my bot see my password when I connect an app?

No. You sign in on the app's own page, and Mercbot receives a key that lets your bots act for you. Your password never reaches Mercbot.

### Can other people in my home use my Gmail?

Yes, if you connect it in that home: everyone in the home, and their bots, can read and send from it. Each email a bot writes shows which mailbox it's from, and waits for a yes like any card. A bot sees the sign-in codes and sign-in links in it only when you're the one asking. To keep a mailbox to yourself, connect it in a home only you are in.

### Why is my app showing "Needs more access"?

The app now asks for more than it did when you connected it. It keeps working with what it has. Select **Sign in again** to give it the rest.

### Can I use an app that isn't in the catalogue, or isn't ready yet?

Yes, through its website. Ask the bot to do the job and it'll use its browser, signing in with a saved login, the secure form, or by handing you the screen.

### Will closing the live view stop my bot?

No. The live view only shows the screen. The bot carries on, and you can open the view again from the chat.

### Why did my bot's computer forget its sign-ins?

Someone reset it: **Reset** in **Settings** > **Computer** clears the saved sign-ins and website data of the computers in the chats where the person who selects it is the only person. Sleeping and updates keep them. A bot's computers in its other chats are separate, with sign-ins of their own.

## Related pages

- [The vault: saved logins and secrets](/help/vault)
- [Approvals, safety and privacy](/help/approvals-and-privacy)
- [Files, documents and pictures](/help/files)
- [Skills, routines and watches](/help/skills-and-routines)
- [Rooms, people and bots](/help/chats)
- [Settings and notifications](/help/settings)
- [Fixing common problems](/help/troubleshooting)
