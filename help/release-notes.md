# Release notes

What's new in Mercbot, newest first. To see which version you're using, open the account menu, choose **Help and support**, then **About Mercbot**. You can also ask any bot "What's new in Mercbot?"

## 20 November 2026

- **Archive a conversation:** right-click one of a Shared bot's tabs, or press and hold it on a phone, and choose **Archive** to put away a conversation you've finished with, after Mercbot asks. A shared tab is hidden for everyone in the home; the person who started it and the home's owners and admins can archive it, but not General or an app's tab with the Builder. Your **You only** tab can be archived too, for you alone. Nothing runs in an archived conversation: its routines and watches pause, saying so in a **Paused while archived** line, nobody can write there, and search doesn't find it. **Archived (N)** at the end of the tabs, and **Conversations** in the bot's Details panel, list the archived conversations with who archived them and when, and **Resume** brings one back in its place, as it was. The same menu also has **Rename**.
- **Tabs you can read:** a Shared bot's tabs and the bot's name at the top of the chat now sit on a solid band, in light and dark, so the conversation no longer shows through them as you scroll.
- **A Shared bot's line in the sidebar** now shows its latest reply in its shared tabs, whichever tab you have open, so you see what the home's conversations are doing. Its replies in your You only tab no longer show there.
- **Templates the bot writes for you:** when no template fits, **Make a new template** in **New bot** or in a bot's **Change template** drafts a whole one from a sentence, and **Start from this bot** in Change template drafts one from the bot itself, with its additions folded in if you tick **Fold in**. Change any part by typing, or **Ask for changes**: the bot writes it again, what changed is highlighted and **Undo** steps back. Problems show under each part and must be put right before saving. **Save and use** keeps the template in your home and moves the bot onto it; in New bot, **Create** makes the template and the bot together. Each draft is one request to the AI, counted in **Spending** like a reply.
- **New bot asks what it will do:** first the **General helper**, your home's templates and Mercbot's library with its search and **Tested** badges, or **Make a new template**; a chosen template is shown whole; then the name, cloud and colour, and **Create**. A template's link now opens New bot with that template chosen.
- **Settings → Templates:** your home's templates, with how many bots use each. Owners and admins **Edit** one on the same screen, saving after a warning of how many bots the change reaches, which their **Instructions** then show, and **Delete** one no bot uses.
- **Every bot is a template plus its additions:** each bot now follows one template, from Mercbot's library or your home's own, plus its own **additions**, rules for that bot alone; where they differ, the template wins. The template's tag replaces the label beside a bot's name in the sidebar, the chat header, pickers and search, with a small cloud for one of Mercbot's and a **+** when the bot has additions; **Ctrl+K** finds a bot by its tag. **Instructions** comes first on a bot's **Details** tab: one line saying what the bot is, its template read-only with what changed in it and when, and its additions, which its maker and the home's owners and admins edit, or the bot changes on a card you approve. **Change template** there points a bot at another template: it keeps its name, look, chats, routines and additions, says so in its chat and asks the new template's setup questions. When you correct a bot the same way twice, it offers to add that to its additions. Your bots moved over by themselves, and a copy of what each one had was kept: a bot added from a gallery template you hadn't changed follows that template; a bot with instructions of its own follows a template of your home made from them, tagged from a one-word label or else its name; a bot with none is a **general** bot. Labels are gone.
- **You only:** a Shared bot keeps each person's own chat with it, as its last tab, **You only**, with a lock. It's the same chat as before, with its messages, routines, files and computer, and only you see it. Before, making a bot Shared hid everyone's own chats with it, while their routines kept running. In You only the bot works as in any private chat and knows the shared tabs by name only, and nothing goes out of it: a tab started there with **+** starts empty, and asking another bot from it lands in that bot's chat with you. Each tab is unread on its own, and **Ask Builder** opens the app's tab whichever tab is open.
- **Files and computers follow the conversation:** in a Shared bot's shared tabs, files go in the bot's folder for everyone using it and the bot works on that tab's computer; in You only, and in every other chat of your own, they're yours. Before, they followed the bot's mode, so a routine in your own chat could save into the folder for everyone once the bot was Shared. A Shared bot's **Files** in the Details panel now shows **Just me** too, beside **Everyone using** the bot and the home's folder.
- **Changing who sees what asks first:** choosing a mode under **Who sees what** asks, for example, **Make Planner Shared?**, saying what changes and for whom, with **Make it Shared** and **Cancel**. Making a Shared bot Private or Mixed hides its shared tabs from everyone, without deleting them, until it's Shared again: their routines and watches pause, each such tab says which in a **Paused while hidden** line, so you can resume them there later, and a long job there stops at its next step.
- **Search opens the right tab:** a Shared bot's message, routine or made file found with **Ctrl+K** opens in the tab it's in, shared or You only. Search no longer finds what's in hidden tabs.
- **Who sees what in a home of one:** in a home with only you, **Who sees what** now shows only for a bot that isn't on the home's mode for new bots (Mixed unless chosen), so you can set it back. With nobody else there, the modes differ only by a notebook nobody else reads.
- **A home's mode for new bots:** each home now has a mode every new bot made there gets, with **New bot** or from a template or a link: Mixed, as before, until an owner or admin chooses. **Create a home** asks **Who's it for?**: **Just me** (Mixed) or **A team** (Shared). A new home's first bot asks the same right after you name it ("Will anyone else use this home with you?"), and owners and admins can change it any time in **Settings** → **General**, under **Home**. When a second person joins, owners and admins see a note at the top of the bot list, once, offering **Make them Shared** or **Keep Mixed**. Bots you already have keep their mode, and group chats aren't affected. A new Shared bot starts with General and opens on your own You only.
- **Rename a home:** owners and admins can now change a home's name, the first home Mercbot made for you included, in **Settings** → **General**, under **Home**. Everyone in the home sees the new name at once, in the sidebar and the list of homes; members see the name there. Before, a home kept the name it was made with.
- **Bots decide when to join in:** in a Shared bot's shared tabs, in a home of two or more people, the bot now answers when it makes sense instead of after every message: a question for it or for everyone that it can usefully answer, or a conversation you're having with it. People chatting among themselves get no reply and no "working" line. Naming the bot, @-mentioning it or replying to one of its messages always gets an answer, and so do your answers to its cards and the first message in a new tab. Owners and admins can turn it off in **Settings** → **General**, under **Home**, and then the bot answers only when called. Deciding is a small AI call counted in the home's usage. You only, Private and Mixed bots, homes with only you and group chats work as before.
- **No prices on bots:** a bot no longer shows what it cost beside its name in the sidebar, even when you point at it. What each bot cost is in **Settings** → **Spending**, in the report's totals by bot, as before.
- **Mercbot's name in your browser:** the browser tab, a bookmark and a shortcut added to a phone's home screen now say **Mercbot**, instead of **Account App**.
- **Connecting apps is tied to your browser:** a sign-in in **Connect apps** now finishes only in the browser that started it. If the app's page sends another browser back, such as someone you sent the sign-in page to, the tab says **This sign-in was started in another browser, so nothing was connected**, and nothing is, so nobody can get your account connected to theirs with a link. On a copy linked to a Mercbot hub, the sign-in tab opens on the hub first and asks you to sign in there with the linked account if you aren't already.

## 19 November 2026

- **Instructions for every bot:** each bot's Details panel has **Instructions**, the rules the bot follows in every reply. The person who made the bot and the home's owners and admins write and change them there with **Save** and **Cancel**, up to 20,000 characters; everyone else can read them. A bot made from scratch can now have its own, and a template bot's can be changed: it keeps **Came from**, and the panel says its instructions are changed from the template's. You can also ask a bot to change its own instructions: it shows them before and after on a card, and changes them only when you select **Go ahead**.
- **Sedna:** bots can read your teams' shared email in Sedna: the newest messages, messages by tag or job reference, one message with its comments and attachments' names, and lists of tags, job references, teams and contacts. An owner or admin connects it in **Connect apps** with API credentials made on Sedna's **API Credential Management** page. Bots read only your own Sedna teams, found by your email address, or by the Sedna user you pick and an owner or admin confirms.
- **Working in Sedna:** bots can also write messages and replies for you on a draft card that sends from Sedna as you, from one of your teams, with a team's template or files from the bot's files. They can save and change your own Sedna drafts, tag messages, link job references, assign a message to a colleague (asking first), save attachments into the bot's files, and add or change contacts when you ask. A reply goes out as a new message with the original quoted, because Sedna's API can't answer inside a conversation's thread. A routine can work on new Sedna mail, a bounded batch each run, leaving sends for you. A copy that isn't live changes nothing in Sedna. Credentials another program uses with Sedna as a username and password work too: the username is the client ID, the password the client secret, and Mercbot uses them as a username and password when Sedna gives no key for them.
- **Request pace for every app:** each connected account's page in **Connect apps** has **Request pace**: **Gentle** (every account's, unless you change it), **Normal** or **Fast**, a tenth, four tenths or nine tenths of what the app allows. Mercbot keeps all your bots' and routines' requests to it together, and when an app asks it to wait, it sends that account nothing until then; the bot says "*App* is busy: try again in *N* s. Nothing was done." A routine that meets a busy Sedna reads the same new mail on its next run, instead of skipping it. Sedna also takes fewer requests: matching a home's people reads Sedna's users a hundred at a time, and reading a message asks only for the tags, job references and attachments it has.
- **Adding Sedna twice at once:** two owners or admins adding Sedna at the same moment now make one account for the home between them, instead of two empty ones.
- **Finding your skills:** **Skills**, the book at the bottom of the sidebar beside **Connect apps**, opens **Your apps and skills** at **Private skills**, where you open a skill to change it. So do **Ctrl+Alt+W**, which opened the app catalogue before, and **Skills** in the search palette.
- **The Terminal** on a bot's computer opens again, and so do the windows a coding job's progress and a coding tool's sign-in show there. Each closed as soon as it opened.

## 15 November 2026

- **Where a copy runs:** the small tab at the top of a copy that isn't live now names where it runs, **Development**, **Test** or **Staging**, instead of **Test copy**. As before, such a copy only records what bots would send or share from your connected accounts and what Apps scripts would send to outside web services. Only a copy set up for real use (`APP_ENV=production`) sends them, and a copy that doesn't say where it runs doesn't start, saying what to set.

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
