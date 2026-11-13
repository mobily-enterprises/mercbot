# Security overview

This page is for people reviewing Mercbot for security or compliance. It goes topic by topic through how Mercbot is built, how people and homes are kept apart, the bots' computers, connected accounts and their keys, approvals, the vault, where data is stored and what goes to the AI model, how bots handle untrusted content, what's recorded, and what Mercbot doesn't claim. Each topic is a short summary; the related pages have the detail. For direct answers to common questions, see [Security questions and answers](/help/security-questions).

## Architecture at a glance

Mercbot is a web application. People use it in a browser on a computer or phone.

- **Your computer.** Mercbot runs as a Node server on your own computer, for you alone, and answers only there (see **Opening Mercbot** below).
- **Database.** Everything people need lives in one PostgreSQL database: accounts, homes, bots, chats, routines, approvals, the vault, and Apps data. Bots' files, saved browser profiles and screenshots are on a shared file volume instead (see below). Work that must happen once, such as a routine run, is claimed through the database so only one server does it.
- **The AI model.** One AI model, at two providers: Together AI and DeepInfra (see [Data storage and the AI model](#data-storage-and-the-ai-model)). Every model call is made from the servers. The provider keys never leave them.
- **Bots' computers.** Each awake bot computer is a small desktop running on your computer, with Chrome and the office apps in gVisor.
- **Files.** Bots' files are kept on a shared, encrypted file volume, or in a home's own WebDAV storage if its owners choose.
- **Connected apps.** Mercbot calls Google, Microsoft, GitHub, Calendly, Notion and Todoist on people's behalf with keys they grant by signing in on the provider's own page.

**The server's state is the truth.** Cards, buttons and waiting states are drawn only from what the server has recorded. The model can only ask for changes through tools, so its words can't create, approve or cancel anything. A reply that claims an action no tool performed is sent back to be corrected.

## How people and homes are kept apart

**Opening Mercbot.** Your own copy of Mercbot opens only with its key, which `mercbot open` uses; anything without it, including other people's accounts on the same computer and other websites, gets a page saying to open Mercbot that way. See [Running your own copy of Mercbot](/help/own-copy).

**Homes.** Everything belongs to a home: bots, files, computers, Apps and usage. Every request for a bot, file or computer names its home, and a request for something in a home the person doesn't belong to answers "not found".

**Roles.** A home has one owner, and admins and members. Owners and admins manage sharing choices, the home's connected accounts and Apps settings. Members use the home's bots and Apps.

**Private by default.** Each person's chats with a bot are their own. Owners and admins can't read them. A bot can be set to private, mixed (private chats plus a home notebook of reusable notes) or shared (conversations everyone in the home sees). What a bot remembers about a person, their own connected accounts, their vault and their own skills are never used in shared conversations.

**Apps data.** Each home's Apps records are kept in a space of their own, which no other home can reach. Inside a home nothing in Apps is private: everyone in it sees every app and view and changes every table, and every change is recorded with who made it. Records are never deleted, only marked obsolete. No one outside the home reaches them.

**Public screens.** An app's public screens reach only what its visitor access lists. Each table opened to visitors has its own read, add and edit rules, applied by the server to every query and write, so no screen or script reaches further.

## The bots' computers

- **One computer per conversation.** With a private or mixed bot, each person has their own browser, so their website sign-ins never reach anyone else. A shared bot's conversation has one browser for everyone in it.
- **Browser and office apps in gVisor.** On the computer's desktop, Chrome and the office apps run together in gVisor, which puts its own kernel between them and the server's. They see a fixed set of tools, the computer's screen, the browser's profile and the chat's file folders, and nothing of Mercbot. A server without gVisor doesn't start bots' computers at all.
- **Internet only through a gateway.** The browser and apps have no network of their own. Their only way out is Mercbot's gateway, which connects only to public internet addresses, never to the server itself, its private network or cloud metadata addresses, and never to the ports used to send email.
- **Office apps and voice memos outside the computer.** When a bot makes or reads a document with its document tools, draws a chart or records a voice memo, and when Mercbot shows a file's preview, the program runs in gVisor too, like the bot's commands: no network, and only that chat's file folders.
- **The command line.** Bots' commands run in gVisor, which puts its own kernel between the command and the server's, so a flaw in the server's kernel isn't enough to get out. Each command:
  - has no network at all;
  - sees only a fixed set of tools (its changes vanish after the run), a scratch folder, and the folders of the chat it ran in;
  - gets none of the server's settings or secrets;
  - has limits on time, memory per process and in total, processes, open files, file size and output.
  
  When one bot works for another, the person's own folder and the home's are read-only to its commands. Every command is recorded with its output and shown in the chat. The command line runs on the same servers as Mercbot itself; moving it to separate machines that hold no secrets is planned as use grows.
- **Local-only ports.** The browser's debugging port and the screen-sharing server listen only on the machine itself.
- **Live view.** People watch a bot's screen through the Mercbot servers with a one-time ticket that's valid for 30 seconds. Watching is view-only until the person presses **Take control**. People can open the live view only for their own conversation's computer, or for a shared conversation they're in.
- **No model key on the computer.** All model calls happen on the servers. The computer only receives concrete actions, such as a click or typing into a field, so a web page can't reach the model key.
- **Saved browsers.** When a computer sleeps or its server stops, its browser profile is archived without caches, sealed with the vault key and kept on the shared file volume, outside everyone's folders; the database records only which file is current and its checksum. People can clear it with **Settings**, **Computer**, **Reset**.
- **Screenshots** of the pages bots work on are files on the same volume, readable only through their own chat, and deleted with it.

The browser reaches the web only through the gateway described above.

## Connected accounts and their keys

- **Sign-in on the provider's page.** People connect Google, Microsoft and GitHub accounts through the provider's own consent screen (OAuth with PKCE). Calendly, Notion and Todoist work the same way through the MCP sign-in rules: Mercbot finds each app's sign-in server from the app's own description of its connection point, accepts it only if it describes that very address, offers PKCE (S256) and is on https throughout, registers itself there once as a client with no secret, and names the app's connection point on every key it asks for. These requests reach public internet addresses only: an app whose description leads to Mercbot's server, its private network or a cloud metadata address is refused. Bots get a key, never the password.
- **Sealed tokens.** Tokens are encrypted with AES-256-GCM under the deployment's vault key before they're stored.
- **Scopes.** Each app's permissions are fixed in its definition, and the provider shows them on its consent screen. Calendly, Notion and Todoist decide their own: Mercbot asks for what the app's connection point names, and the app shows it on its consent screen. Google Drive asks for full Drive access so bots can work on any of the person's files.
- **Whose account.** An account belongs to one person ("Just me") or to the whole home. Only owners and admins add or remove a home's accounts. Shared conversations use only the home's.
- **Switches.** Every action a bot can take with an app has its own switch in **Connect apps**, under the app's **Tools**. A switched-off action is removed from the person's bots, and they're told not to do it on the app's website either.
- **Disconnecting** drops Mercbot's stored tokens straight away. For Calendly, Notion and Todoist it also asks the app to withdraw them. A key the app stops accepting signs the account out.
- **Linked copies.** A copy can borrow the registered apps of a hub it is linked to. The hub keeps the long-lived permission; the copy fetches a short-lived key each hour and calls the provider directly, so mail, calendars and files don't pass through the hub. Calendly, Notion and Todoist aren't borrowed: each copy registers itself with the app and keeps its own keys.

## Approvals

Reading never asks. Actions that change something and can easily be undone run without asking unless the person has a rule saying otherwise. With **Auto-review** on, which is the default, actions that send, delete, share, invite, comment, or finish a purchase or booking on a web page ask first on an approval card with **Go ahead** and **Don't do it**.

- **Exact action.** Approving runs exactly the action stored on the card. The card is claimed in a database transaction, so it can't run twice.
- **Explicit requests.** If the person's own message asked for exactly that action with its details, that counts as approval, unless one of their **Always ask** rules applies.
- **Personal policy.** Each person has their own **Auto-review** switch and plain-language **Always ask** and **Allow without asking** rules. Asking first wins when rules disagree. With the switch off, actions run unless an **Always ask** rule applies.
- **No action after a decision.** The reply straight after an approval decision only reports back.
- **Templates.** Bots from the gallery set up their routines paused, and people see a template's full instructions, skills and routines before adding it. Gallery templates are written by the Mercbot team; people can't submit their own to it.

See [Approvals, safety and privacy](/help/approvals-and-privacy).

## The vault and other secrets

- **Vault.** People keep logins, cards and contact details in a personal vault. Passwords, notes, card numbers, security codes and billing addresses are encrypted with AES-256-GCM under the vault key. Secrets are never sent back to the page in full. A CSV import is read in the person's browser, and its items are checked and sealed on the server like items added by hand.
- **No secret goes to an AI.** Contact details can be read from a photo the person chooses (Google's Gemini reads it; Mercbot doesn't keep the photo), but logins and cards are never read that way, so no password or card number reaches a model.
- **Bots don't see secrets.** A saved login is filled into the website by Mercbot itself; the bot never sees the password. Bots never see a saved card's number or security code. A secure form lets people type a login or code that goes straight into the site.
- **Kept out of chat.** Bots never ask for passwords, card numbers or codes in the chat. A password from the person's vault is blanked out of any reply. A bot types a password only if the person gave it in that chat, never one read from a page.
- **Other sealed secrets.** Connected-account tokens, saved browser profiles, a home's own storage password and the secret headers Apps scripts send to outside services are all sealed with the vault key. Script secrets are never shown again after they're saved.

## Data storage and the AI model

- **Database.** PostgreSQL holds accounts, chats, memories, approvals, the vault, Apps data and usage. Files, saved browsers and screenshots are on the file volume.
- **Files.** Bots' files live on a shared file volume that's encrypted when it's created; its index is in the database and its data in object storage. A home can choose its own WebDAV storage instead.
- **Machines are disposable.** Nothing a person needs is kept only on one server. Profile pictures are on the file volume too.
- **What goes to the model.** To answer, the model receives the bot's instructions, the conversation (recent messages word for word and a summary of older ones), a note of the bot's current state and the results of its tools, including text it read from pages, mail and files, and pictures attached to the message. Lasting facts a person asked bots to remember are included too.
- **Providers.** Mercbot runs one AI model at two providers. Together AI, in the United States, answers in chats, including groups and requests between bots. DeepInfra writes the Builder's replies, and does the work nobody is waiting on: routines, watches, follow-ups to long commands, long jobs that carry on by themselves, and summaries of long conversations. Each receives what that work needs, as listed above. Mercbot doesn't offer a choice of provider or region.
- **Pictures.** When it's set up, bots draw and edit pictures with Google's Gemini; a picture to be edited is sent with the request. Gemini also reads contact details from a photo a person chooses on the vault's contact form, told never to follow instructions written in it.
- **Usage** records each AI call's tokens, pictures, computer days and command time per person, bot and home, with what it cost at the AI provider. It doesn't hold message content.

## Untrusted content and prompt injection

- **Labelled as information.** Text from web pages, emails and GitHub reaches the model marked as content to read, never instructions, and every bot's standing instructions say the same for anything quoted from emails, web pages or files.
- **Pictures.** The model that describes pictures for bots is told never to follow instructions written in them.
- **Apps data.** Records reach bots as data. Values typed by public visitors are marked untrusted.
- **Templates.** A template's own instructions run inside Mercbot's rules, and where they differ, Mercbot's rules win.
- **Pages.** A page a bot writes runs sealed off in the browser: it has no access to the person's account, cookies or data, can't call Mercbot or any other address, submit forms or open windows, and loads only the files copied into it when it was saved, which Mercbot fetches from public internet addresses only. It can ask Mercbot for just two things, each checked and only right after the person clicks: to open a link in a new tab, or to open one of the home's own apps. Browsers can't stop a page's script from sending its own page to another address, so a page published to a website runs no scripts at all.
- **Safety net.** Even if a page fools a bot, it can't approve its own card, turn a switched-off action back on or read a saved password.

## Logging and activity

- **Chats.** Every action a bot takes leaves a line in the chat, such as "Added to your calendar" or "Sent the draft", and approval cards stay in the history with their answer.
- **Apps Activity.** Every change to a home's Apps records is recorded with who made it (a person, a bot, a script, a watch or a public visitor), where, and each value before and after. A change whose record fails isn't made. App creation and publishing are recorded too.
- **Scripts.** Each Apps script keeps its last 200 runs with time, calls, errors and log.

## What Mercbot doesn't claim

- No security certifications or third-party audits.
- No way to reach private company networks from bots' computers, and no published list of fixed outgoing addresses.
- No choice of model provider or processing region for a home.
- No admin view of members' private chats, and no export of activity to outside security tools.
- Bots' commands run on the same servers as Mercbot, inside gVisor, not on separate machines. On a server set up for launch, gVisor runs as a separate Linux user with no access to Mercbot's settings, database password or keys, so even a program that got out of gVisor couldn't reach them.

## Related pages

- [Security questions and answers](/help/security-questions)
- [Approvals, safety and privacy](/help/approvals-and-privacy)
- [Homes: Mercbot for families and teams](/help/homes)
- [The vault: saved logins and secrets](/help/vault)
- [The bots' computer and connected apps](/help/computer-and-apps)
- [Running your own copy of Mercbot](/help/own-copy)
- [Versions, activity and undoing changes](/help/apps-versions)
