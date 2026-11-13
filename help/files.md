# Files, documents and pictures

Bots don't just talk: they read the files you send and make real ones for you, such as documents, spreadsheets, presentations, PDFs, charts and pictures. This page explains how to give a bot material to work with, where its files are kept and who can see them, what it can make, how to open and download results, and how to move files to and from Google Drive or OneDrive.

## Attach files to a message

1. Select **+** beside the message box, then **Attach files**.
2. Choose one or more files. Each appears above the message box with its name and size; select its cross to remove it.
3. Add a note if you like ("Summarise the second section"), or just send.

In a bot's own chat, each file you attach is kept in the bot's **Uploads** folder. The bot is told where it is and can open it now, or later in the conversation when you ask about it again. If a file with the same name is already there, the new one gets a number added.

### What bots can read

| Kind of file | What the bot does |
| --- | --- |
| Documents (such as .docx, .odt, .rtf) | Reads the text with its office apps. |
| Spreadsheets (such as .xlsx, .xls, .ods, .csv) | Reads the sheets and their contents. |
| Presentations (.pptx) | Reads the slides. |
| PDFs | Reads the text. |
| Text files (such as .txt, .md, .csv, .json) | Reads them as they are. |
| Pictures (PNG, JPEG, GIF, WebP) | Looks at them. A picture sent with your message is seen straight away; for an older one, the bot looks again with your question in mind. |

### Limits

| Limit | Details |
| --- | --- |
| Each attached file | Up to 25 MB. |
| Pictures the bot can look at | Up to 10 MB each. |
| HEIC photos (common on iPhones) | Can't be opened. Send them as JPEG or PNG. |
| Very long documents | The bot reads a large amount of text, but the very end of an extremely long file may be cut off. Point it to the part you need. |
| Group chats | Files aren't kept for the bots. Only the text of small text files (up to about 200 KB) reaches them. Send other files to a bot's own chat. |

## Share links

Paste a link into your message and the bot can open it in the browser on its own computer and read the page. When a reply used the web, it ends with a screenshot of each page the bot worked on; select one to see it large or download it.

If a page needs you to sign in, the bot uses a login you've saved in the vault, asks you through a secure form, or hands you its screen for that step. It never asks for passwords in the chat. See [The bots' computer and connected apps](/help/computer-and-apps) and [The vault: saved logins and secrets](/help/vault).

## Where a bot's files live

Every home keeps its bots' files in three kinds of folder.

| Folder | Who sees it |
| --- | --- |
| **Just me** (/files/mine) | You and that one bot. Files you attach, and files it makes for you, go here. A Shared bot has no "Just me" folder, because everyone talks with it together. |
| **Everyone using the bot** (/files/bot) | Everyone in the home who uses that bot. Good for the bot's working material, such as the invoices folder of a bookkeeping bot. |
| **The home's folder** (/files/shared) | Everyone in the home, and all the home's bots. |

So a document one of your bots makes is private to you and that bot unless you ask for it to be shared. To let your other bots use a file, ask: "Put the budget in the home's folder so Ledger can use it." The bot moves it. Ask again to move it back. Remember that the home's folder is seen by everyone in your home, not only by your own bots.

Inside its folders, a bot keeps things tidy: **Uploads** for what you attached, **Charts** and **Pictures** for what it drew, and clear names for documents.

You can ask a bot "What files do you have?" at any time. It lists its files, newest first.

### See and manage the files yourself

- **A bot's files:** open the bot's details and choose **Files**. You see **Just me**, **Everyone using** the bot and the home's folder.
- **The home's files:** choose **Files** in the sidebar, just above **Apps**. You see the home's folder, and every bot, each leading to its own files.

Each folder shows its newest 300 files and says how many older ones it leaves out. A folder with more than 5,000 files shows the newest 300 of the first 5,000 it finds, and says so.

In both places you can open a file in the viewer, download it, upload files, make a folder, and use a file's **⋮** menu to **Move to…** another folder, **Rename** it or **Delete** it. Deleting asks first and can't be undone; a folder can only be deleted when it's empty.

### The home's own storage

By default, Mercbot keeps the bots' files. A home's owners and admins can choose to keep them elsewhere, in **Settings → Files**:

- **In Google Drive:** a Google Drive account connected in **Connect apps**, either your own or one of the home's. Mercbot makes one folder there, named after the home, and keeps the bots' files in it. You can open that folder in Google Drive like any other.
- **In the home's own storage:** Nextcloud or any storage with a WebDAV address. The bots' files live there, in a Mercbot folder.

Changing where the files are kept moves all of them to the new place, every time, and the new place becomes an exact copy: whatever was there before is replaced. It usually takes a few minutes, and **Settings → Files** shows how far it's got, with **Cancel** for owners and admins. Meanwhile the files can be read but not changed: the bots and the Files page say "Moving this home's files…", and changes work again once it's done. Once it's done, a Google Drive folder left behind goes to that Drive's bin (Google keeps it for 30 days), and Mercbot's own copy is deleted. A move that's cancelled or fails leaves the files where they were.

Deleting a file kept in Google Drive puts it in Drive's bin, where you can still restore it.

If the Google Drive account needs signing in again (for example after you removed Mercbot's access in your Google account, which Mercbot notices within seconds), the Files page and **Settings → Files** say so. The files stay safe in Drive; the bots can't use them until it's signed in again. A person's own account can be signed in again only by them, and a home's account by its owners and admins: they see **Sign in again**, and everyone else is told to ask them.

Choosing the same Google Drive account again, even after keeping the files somewhere else for a while, uses the same folder, as long as it's still there and not in Drive's bin.

**Settings → Files** shows how much space is free in that Google Drive. When less than 1 GB is free, it warns that the Drive is nearly full, and the Files page says so too: once it's full, the bots can't save files there until you free some space in Google Drive or get more from Google.

If Mercbot's folder is put in Drive's bin, what the bots save goes to the bin with it, and Google deletes what's in the bin after 30 days. **Settings → Files** and the Files page say so. Take the folder out of the bin in Google Drive, or, as an owner or admin, select **Choose again** in **Settings → Files**: Mercbot makes a new folder in the same Drive and moves the files into it. A folder deleted for good is shown the same way; choosing again then starts an empty folder.

## Documents, spreadsheets, presentations and PDFs

Each bot has a set of office apps it uses out of sight, without opening a window:

| App | What it's for |
| --- | --- |
| **WordCraft** | Documents: Word documents (.docx), .odt, .rtf, Markdown, text and HTML. It can also save PDFs. |
| **GridCraft** | Spreadsheets: Excel files (.xlsx, .xls), .ods and .csv. |
| **DeckCraft** | Presentations (.pptx). |
| **PdfCraft** | PDFs: editing, filling in forms, combining, splitting, blacking out text and signing. |

Ask for what you need in plain words:

- "Write a one-page letter to the landlord about the leaking tap, as a Word document."
- "Make a spreadsheet of these receipts with a total at the bottom."
- "Turn this report into five slides for Monday's meeting."
- "Combine these two PDFs and fill in the form on the last page."

Bots make real files: real headings in documents, formulas for totals in spreadsheets, and proper slides. They can also change files you send or files they made earlier: "Add a column for VAT to the spreadsheet you made yesterday."

### Ask for something you can check

The best results come from asking for a form you can check quickly:

- a table rather than a long paragraph, when you're comparing options;
- a spreadsheet with formulas, so you can see how a total was worked out;
- a short summary at the top of a long document;
- a chart when you're looking for a trend.

If a result isn't right, say what to change. The bot can change the same file, or make a fresh one if you'd rather.

## Charts

Ask a bot to chart some numbers and it draws the chart as a picture right in the chat, with a sentence saying what it shows, such as the highest or lowest point. Charts can be columns, bars, lines, pies, doughnuts, areas or stacked columns, with up to six series. A single series of columns shows its highest column in a second colour.

Select a chart to open it full-size with its caption and a **Download** button. Each chart is saved in the bot's **Charts** folder and listed in its Library.

Bots chart real numbers only: the ones you give them, or ones they've found or worked out. For a chart inside a spreadsheet or presentation, ask for it in that file instead.

## Pictures

Bots can draw illustrations, invitations and artwork, and restyle photos you send.

- **Make a picture.** "Draw a birthday invitation with balloons and a space theme." The bot posts a short line at once, and the picture follows, usually within 20 to 60 seconds. Pictures are portrait.
- **Change it.** "Make the background blue and add a banner that says Happy Birthday." The bot edits that picture, keeping everything you didn't ask to change. The earlier version stays in the chat.
- **Restyle a photo.** Attach a photo and ask: "Turn this into a watercolour."
- **See options.** Ask for options or other styles and the bot makes two side by side, then talks about "the first" and "the second". Pick one and it carries on from that.

The bot makes one picture, or one pair, per reply.

### What bots won't draw

Bots never make pictures of real, named people or copies of logos. Instead, they say so in one line and make an original alternative straight away: for a person, a picture with no person in it, only objects and symbols that suggest them (for a singer, perhaps a microphone and stage lights); for a logo, an original design in the same spirit.

### Open and save pictures

Pictures show under the bot's reply. Select one to see it full-size with its caption, and to download it. Each is kept in the bot's **Pictures** folder and listed in its Library with a thumbnail.

## Pages

A page is something to keep or come back to that a bot writes for you: a plan for the weekend, a guide, an invitation, a trip tracker or a checklist. Ask for one in plain words, such as "make me a page with two plans for a rainy Sunday and a packing list".

- **Mercbot's look, or its own.** Pages have Mercbot's look by default, with tabs, a numbered timeline, link cards, notes and tick-off checklists. A bot can give a page a look of its own when it fits, so an invitation can look like an invitation, and small scripts such as a countdown, a quiz that checks answers or a calculator.
- **Pictures from the chat.** A bot can put the picture it just made, or one you sent, on the page.
- **Nothing from the internet while it's open.** When a page is saved, the pictures, fonts and scripts it names are copied into it, so it never loads anything while you read it. The bot tells you if something couldn't be copied.

### Open a page

A page arrives as a card under the bot's message, with a look at its top. Select the card, or the page's name in the bot's message, and the page opens in place of the chat. The message box stays at the bottom, so you can keep talking to the bot while you read. **Close** takes you back to the same place in the chat.

- **Tick off** a checklist's items. Ticks are saved in the page, so everyone who opens it sees them; **Reset** clears them.
- **Links** open in a new tab.
- **App buttons** open one of your home's apps in its own view, such as a quiz for the lesson you're reading. A page can only open apps in your home.

### Change a page

Ask the bot: "add the café's opening hours to the page". It changes the same page instead of making a new one, and the card shows the new version. Every version is kept: select **…** then **Versions** to see them and **Restore** an earlier one. A restored version comes back as it was then, with its ticks.

### Share a page

A page belongs to your home, like the home's files: everyone in the home can open it. Select **Share** to see who can open it. To show a page to someone outside, publish it to your website (below), or keep a copy and send them that.

### Publish a page to your website

If you already have a website, a page can go on it too, at an address of its own that anyone can open. Set the website up once in **Settings** → **Website** (see [Settings and notifications](/help/settings)), then open the page, select **Share** and, beside **Your website**, select **Publish**. The first time, Mercbot asks you to confirm, since the page will be on the internet for anyone. The page's address appears with **Copy** and **Open**.

- **What goes up** is the page with its look and pictures, without its scripts (a countdown or quiz won't run there; the text and pictures do). Your website gets a folder named after the page (for example `garden-plan/`) holding the page and its pictures.
- **Mercbot checks the address** after each upload. If the page doesn't answer there, it says so: usually the website's address in Settings doesn't match where your web server serves that folder.
- **Publish again** after the bot changes the page, to replace the copy on your website. **Unpublish** takes it off.
- A page that moves keeps its address; a page that's deleted is taken off your website.

Only the home's owners and admins publish; anyone in the home can unpublish.

### Keep a copy of a page

Select **…** then **Download a copy**, or ask the bot to keep a copy. You get one web page file with the page's pictures, look and scripts inside it, which opens in any browser, offline too. To get a PDF, open the copy and print it to PDF from your browser.

## File cards and the viewer

When a bot saves a file during its reply, the file arrives as a card under its message, showing the file's name, kind and size. Select a card to open the viewer.

You can also ask a bot for files it made earlier, or any file in its folders, such as "send me the page 2 file again". It attaches each one as a new card. If it can't find a file, it says so and suggests the closest names. Replies name files rather than showing where they're stored; the cards are how you get them.

- **Documents, spreadsheets, presentations and PDFs** show as pictures of their pages, so they look right on any device, phones included. The viewer shows the first 20 pages; download the file to see the rest.
- **Pictures** show as they are.
- **Text files** show their text.
- **Download** (the arrow at the top) saves the file to your device.
- **Edit on computer** opens a document, spreadsheet, presentation or PDF in its app on the bot's own computer, where you can change it yourself. See [The bots' computer and connected apps](/help/computer-and-apps).

If a file can't be previewed, the viewer offers to download it instead.

## The Library

Everything a bot made for you is gathered in its **Library**. Open the Details panel (select the bot's name, or press **Ctrl+Alt+B**) and choose the **Library** tab.

- Files, charts, pictures and pages are listed newest first, grouped by day: **Today**, **Yesterday**, then dates. Each shows how long ago it was made, such as **5m**, **3h** or **2d**.
- Each day shows five items; select **Show more** for the rest.
- Hover over an item to see what it is, which bot made it and when, and for a page who can open it.
- Select **…** beside an item, or right-click it, and choose **Pin** to keep it at the top under **Pinned**. **Unpin** puts it back.
- Select an item to open it in the viewer; a page opens in place of the chat.

A page's menu also has **Open**, **Share…** and **Delete**:

- **Share…** is the page's **Share**: everyone in the home can open it (see [Share a page](#share-a-page)). An older page, written before pages were web pages, shows who can open it by its folder: only you (**Just me**), everyone using the bot, or everyone in the home; select **Copy text** to copy its words, or **Download** to save it as a file.
- **Delete** asks you to confirm, then deletes the page for good, with its versions, and takes it off your website if it was published there. Its cards stay in every chat, marked **Deleted**, and no longer open.

You can also find files by name with the search palette (**Ctrl+K**). Matching files are listed before messages.

## Google Drive and OneDrive

Once you've connected Google Drive or OneDrive in Connect apps, bots can move files between their own folders and your drive.

### Save a copy to your drive

"Save the report to my Drive." The bot puts a copy in a Mercbot folder in your drive and gives you its link. Files up to 25 MB can be copied this way. If you have several drives connected, say which.

### Bring files in from your drive

- **Find files.** "What did I last work on in OneDrive?" or "Find the lease agreement in my Drive."
- **Read one.** The bot can read the text of a document, spreadsheet or presentation in your drive.
- **Keep a copy.** The bot can download a file into its own folder, or convert one first (for example a Google Doc into a Word document or PDF). The copy arrives as a file card.

### Change things in your drive

Bots can also make folders and documents in your drive, move, rename and copy files, and put files in the bin (they can be restored from there, usually for about 30 days). Sharing a file with someone, or commenting on a Google file under your name, only happens when you've asked for exactly that; otherwise the bot asks first. Each change leaves a line in the chat.

For connecting drives and switching individual actions on or off, see [The bots' computer and connected apps](/help/computer-and-apps).

## Keep a copy of your work

Files stay with the bot that made them, but it's wise to keep your own copy of anything important.

- **Download it** from the viewer or the full-size picture view.
- **Save it to your drive** by asking the bot.
- **Put it in the home's folder** if your other bots will need it.
- **Pin it in the Library** so it's easy to find.

Deleting a bot deletes it and its whole conversation for good, so download anything you want to keep first.

## Questions

### Can my other bots see files I sent to one bot?

Not unless you ask. Files you attach stay in your "Just me" folder with that bot. Ask the bot to put a file in the home's folder, or move it there yourself in **Files**, to make it available to every bot in the home.

### The bot says it can't open my photo.

It's probably a HEIC photo. Send it as a JPEG or PNG instead. Pictures over 10 MB are too big for the bot to look at; send a smaller copy.

### Why can't the bots in my group chat read my PDF?

In group chats, files aren't kept for the bots. Send the PDF to one bot's own chat.

### The bot says it can't make pictures.

Making pictures depends on Mercbot's picture service being set up. If you run your own copy of Mercbot, see [Running your own copy of Mercbot](/help/own-copy).

### Can a page do anything to my account?

No. A page runs sealed off from the rest of Mercbot: it can't read your account, your files or your other chats, loads nothing from the internet, and can't move you to another site. It can open a web page in a new tab, or one of your home's apps, only just after you click or press a key: on a link or button in the page or, for a few seconds, on the card you opened it from. Still, never type a password or other secret into a page: a page's own script can't be stopped from sending its own page somewhere else.

### Can I edit a document myself?

Yes. Open it from its file card and select Edit on computer. It opens in its app on the bot's computer. Or download it and edit it on your own device, then send it back.

## Related pages

- [Messaging and working together](/help/messaging)
- [The bots' computer and connected apps](/help/computer-and-apps)
- [Bots: create, shape, organise and remember](/help/bots)
- [Bots shared in a home](/help/shared-bots)
- [Apps: what they are and when to use them](/help/apps)
- [Fixing common problems](/help/troubleshooting)
