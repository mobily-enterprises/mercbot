# Release notes

What's new in Mercbot, newest first. To see which version you're using, open the account menu, choose **Help and support**, then **About Mercbot**. You can also ask any bot "What's new in Mercbot?"

## 12 November 2026

- **Coding jobs fenced in:** Claude Code and Codex now work in a space of their own on the bot's computer, with only the project's folder and their sign-in. They can't see the bot's other files, its browser or the sites you're signed in to there, and they reach the internet but not the bot's computer. Your sign-in stays as it was.
- **Commands' memory limit:** a bot's command that uses more than 3 GB of memory in all, across its programs, is now stopped and says so, as the limits always said. Before, only each program's own limit held.
- **Changing where a home keeps its files** now moves all of them to the new place, every time, and the new place becomes an exact copy: whatever was there is replaced. **Settings → Files** shows the move's progress, with **Cancel**. Meanwhile the files can be read but not changed, and the bots and the Files page say why. Once it's done, a Google Drive copy left behind goes to that Drive's bin, and Mercbot's own copy is deleted. A move that's cancelled or fails leaves the files where they were. Files that can't be read where they are can be left there with **Switch without the files**.
- **Removing someone whose own Google Drive holds the home's files** waits until the files are moved out of it: **Settings → Home** says so, with **Move the files to Mercbot**.
- **Google Drive storage:** **Settings → Files** shows how much space is free in the home's Google Drive and warns when less than 1 GB is left. It says when Mercbot's folder was put in Drive's bin, where the bots' saves would go too, with **Choose again** to make a new folder. The Files page tells everyone the same.
- **Google Drive storage:** if you remove Mercbot's access in your Google account, the Files page and **Settings → Files** ask to sign in again within seconds, instead of saying the storage isn't answering for up to an hour.
- **Theme from search:** choosing **Theme: Light**, **Dark** or **System** in search saves it to your account again, as **Preferences** does, instead of saying "The theme didn't save to your account."
- **Your picture in the sidebar:** the account button at the bottom of the sidebar shows the profile picture you uploaded in **Account details**, instead of your initials, and changes as soon as you change or remove it.
- **Messages on a phone:** a long message you send no longer leaves an empty band under it.
- **Settings → Home** lists everyone in the home and every invitation waiting again, with the form to invite someone. It showed only its heading, so nobody could invite anyone. A group chat's **Add a person** lists the home's people again too.
- **Mercbot on your own computer (first part):** a copy on your own computer is just for you. It has no sign-in, accounts or invitations: `mercbot open` opens it in your browser, and only on that computer. The `mercbot` command also starts, stops, backs up, restores and upgrades it. The installer comes next.
- **Reading a photo for the Vault** counts in **Spending** what it cost, like any AI call.
- **Sign-in codes go only where your sign-in led:** a bot types a code from your inbox by itself only into the pages the sign-in you asked for leads to, windows such as **Sign in with Google** included. On any other page, even a form on the same site, it asks you first on a card that shows the page's full address and who sent the code.
- **Connect cards:** once you've signed in from a bot's **Connect** card, the bot carries on with its task straight away, instead of a few seconds later.
- **Published bot templates:** a home's owners and admins can update or delete a template someone published from one of its bots, also once that person's account is closed. They find it in the bot's **Share** menu, marked **Published by** its publisher.
- **Calculated fields say what they can't do:** the Builder tells you, when it adds one, that lists can't be filtered, sorted or grouped by it and that sums and averages of it cover up to 5,000 records, and offers a stored field instead when you'll want that. The Data tab and **Fields** say so too.
- **Bot template badges:** a template's **Tested** badge now goes back to **Not tested yet** by itself whenever Mercbot changes the way bots behave, until it is checked again.
- **Calculated fields:** a table can have fields worked out from the record's other fields, such as a total from price × quantity. They're always up to date in lists, records, totals and labels, and a form shows them changing as you type. Ask the Builder for one. Lists can't be filtered, sorted or grouped by them yet.
- **Named formulas:** an app can have its own small formulas, such as "with VAT", which any of its formulas can use. The app's **Logic** tab lists them.
- **Logic tab:** the selected button above a script, **Code**, **Tests** or **Runs**, shows its label again instead of looking blank.
- **Chats that load slowly:** a message you send before a chat has finished loading stays, with the bot's reply or **Try again**, instead of disappearing when the chat loads.
- **Data tab on a phone:** **Fields**, **Import**, **Export** and **New record** move onto a second line when the screen is narrow, instead of running off its edge.
- **Files in Google Drive:** a home's owners and admins can keep the bots' files in a Google Drive account connected in **Connect apps**, in **Settings → Files**. Mercbot makes one folder there for the home. If the account needs signing in again, the Files page and Settings say so, with **Sign in again**, and the files stay safe in Drive.
- **Pages:** the pages bots make are web pages now, with tabs, checklists, pictures and the bot's own look, kept in the bot's **Pages** folder for everyone in the home. A page opens in place of the chat, from its card, a link in a reply or the Library. **Share** gives a link that shows the page to anyone, without a Mercbot account. **Versions** brings back an earlier version, and **Download a copy** saves the page as one file. A page can't reach your account, files or chats.
- **Try a draft for real:** a draft app's **Preview** works on practice data, a copy of your home's records, so **Save**, edits and **Mark obsolete** show in the preview's lists at once. Your real records, the live app and **Activity** never see them. **Reset** starts again, and publishing throws the practice data away.
- **The Builder tries its drafts** on the same practice data before saying they work, then reminds you to press **Publish**, on the preview's banner or the chat card.
- **Vault:** **Import from a CSV file** in the **New item** menu adds many logins, cards or contacts at once, such as a password manager's export, with a preview before anything is saved. The contact info form can be filled in from a photo of a business card or a letter, with **Upload a photo** or **Scan with camera**. Cards are never read from photos.
- **Spending reports:** any day, week, month or range of days, with a chart by day and totals by kind, bot and person, and **Download CSV** for a spreadsheet. Members see their own use.

## 11 November 2026

- **Test copies:** a copy of Mercbot that isn't live yet shows a small **Test copy** tab at the top. It keeps invitations and visitors' sign-in emails unsent, and only records what bots would send or share from your connected accounts and what Apps scripts would send to outside web services. Everything else works as usual.
- **New bots** always appear in the sidebar and open, and their first question can be answered straight away. Making one no longer shows "Bot not found".
- **Calendly, Notion and Todoist** connect in **Connect apps**: sign in with your account there, and your bots can use what the app offers, such as booking links, pages or tasks. They read straight away; a change goes ahead only when you asked for exactly that and the app says it does no lasting harm, otherwise they ask first. Disconnecting also withdraws Mercbot's access at the app.
- **Routines that keep failing pause:** after 5 failed runs in a row a routine pauses itself and its bot says so in the chat, with how to turn it back on. A routine or a job a bot was doing when Mercbot restarted carries on once, from where it got to.
- **Bots finish after you connect an app:** when you sign in from a bot's **Connect** card, the bot carries on with its task by itself once the app is connected.
- **Sign-in codes from your inbox:** when a site emails a sign-in code to your own connected Gmail or Outlook, the bot types it in for you without showing it. Otherwise it still asks you through the secure form.
- **Coding with your own account:** a bot can hand coding work to Claude Code or Codex on its computer, signed in with your own account, and tells you what it changed when it's done.

## 10 November 2026

- **Linking records:** when you link a record in the **Data** tab, the picker searches the whole linked table as you type, so any record can be linked, not just the first 100.
- **Files:** opening a folder in the file browser lists that folder's own files, so a folder of older files no longer looks empty.

## 8 November 2026

- **Public apps:** an app's **Overview** shows exactly what its visitors can reach, table by table, and owners and admins can narrow it. Apps made earlier were given a list that covers what their public screens already used.
- **Account settings:** each section has its own page.

## 7 November 2026

- **A new look,** with new colours and icons in light and dark. Apps, an app, a table and Files have an **Up** arrow at the top (Ctrl+[).
- **Nothing in a home is private in Apps:** everyone in the home sees every app and view and can change every table, and every change is recorded in **Activity**. Owners and admins still choose the Builder and the home's settings. Public apps are the only way in from outside.
- **Long chats open faster:** a chat opens on its newest messages and loads older ones as you scroll up.

## 6 November 2026

- **Views:** ask any bot for live figures from your home's tables, such as "open deals by stage as a chart, and the ten biggest", and it makes a view straight away. A view stays up to date by itself, and apps can show it.
- Views are retired, never deleted. Bring one back from **Apps**, under **Retired**.

## 31 October 2026

- **Change course mid-way:** what you write while a bot works reaches it at its next step, and it changes course within the same reply.
- **To-do card:** for a job with several steps, the bot lists them in a card and ticks them off as it goes.
- **Long jobs carry on by themselves** in the background, without you asking, and say plainly when they stop and what's left.
- A reply cut off while Mercbot updates carries on where it left off.
- **The Terminal** on a bot's computer shows the bot's commands live, with your own command line below.

## 30 October 2026

- **Bot templates:** a gallery of 48 ready-made bots in nine areas, at [/templates](/templates). You see everything a bot is told before you add it. Share a bot of yours with a link that opens a page with **Add to Mercbot**.
- **Bots work together:** a bot can ask another bot in your home and carry on with the answer. A card shows the request in both chats.
- **Group chats with people:** add people from your home to a group chat, and bots use their tools there.
- **The command line:** every bot has its own Linux command line for files: video, audio, pictures, scanned pages, PDFs and data. It has no internet.
- **Three file folders:** just you, everyone using the bot, and everyone in the home, with a **Files** tab in each bot's details and a **Files** page for the home.
- **Connected apps do much more:** Gmail and Outlook labels, folders, filters, whole conversations and saved drafts; free and busy times and repeating events in calendars; searching and sharing in Google Drive and OneDrive, and comments in Google Drive; repositories, pull requests, reviews, issues and automation runs on GitHub.
- **A shared Builder** keeps a conversation for each app, which **Ask Builder** inside the app opens.
- Every bot's picture is now a cloud with its own eyes.
- The help centre.

## 29 October 2026

- **Public apps:** make an app public, with forms and screens anyone can use at its own address and a QR code to print. Visitors can sign in with an emailed code or link, or with Google, Microsoft or GitHub, and an app can be kept to invited people.
- **Scripts:** the Builder writes and tests small scripts for buttons, checks when records are saved, formulas, jobs on a timetable and calls to outside web services. See them in an app's **Logic** tab.
- **Watches:** a bot can watch a table and act when records change. A button can hand a job to a bot, and apps can show charts.
- **Templates:** six ready-made apps: CRM, Stock, Leave requests, Hiring pipeline, Contact form and Bookings.
- **Look:** a home's colour, light or dark, font, corners, spacing and logo for its apps.
- **Tools in Connect apps:** a switch for each action a bot can take with an app.

## 28 October 2026

- **Homes:** everything belongs to a home. Create homes, switch between them, and invite people by email as admins or members.
- **Bots in a home** can be private, mixed (with a home notebook of useful notes) or shared (conversations everyone in the home sees).
- **Connected accounts** can be yours alone or the whole home's.
- **Apps:** the home's Builder bot makes small apps on the home's own data. The **Data** tab works like a spreadsheet, with import and export (CSV and Excel), and **Activity** records every change.
- **A phone layout:** the chat fills the screen, with bots in a menu.

## 27 October 2026

- **Pictures:** bots make illustrations, invitations and artwork, change them, and restyle photos you send.
- **More connected apps:** Outlook mail, calendar and contacts, Google Contacts, saving files to Google Drive or OneDrive, and GitHub issues and pull requests. A draft from a connected mailbox goes out when you press **Send**.
- With Google Calendar or Gmail connected, bots check your schedule, add events (asking before inviting anyone) and search and read your email.

## 25 October 2026

- Bots see the pictures you send, make voice memos, draw charts, and make documents, spreadsheets, slides and PDFs you open in a viewer or on their computer.
- Each bot's computer is a small desktop with a dock of apps.
- Bots make pages you keep, ask quick questions with answers you tap, pass a task to another of your bots, and remember lasting facts you tell them (**Settings**, **Memory**).
- Bots sign in to websites with logins saved in your vault, or show you a secure form, and never see your password.
- Each bot's **Library** lists everything it made. Type "/" in a chat to pick a skill, and set one-off reminders.

## Related pages

- [Welcome to Mercbot](/help/welcome)
- [General questions and answers](/help/faq)
