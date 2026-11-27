# Logic: formulas, scripts and automations

Behind an app's screens there are a few moving parts: formulas that work out values on the fly, scripts the Builder writes for harder jobs, and automations that run when data changes or on a timetable. You never write any of these yourself, but you can always read them, see when they ran and what went wrong, and ask the Builder to fix them. This page is a reference for each, including the safety limits that keep scripts fenced in.

## Formulas

Formulas are short calculations inside an app. The Builder uses them for:

- **calculated values**, such as a person's age from a date of birth, or an amount shown as money
- **show if**, so a part only appears when it makes sense, such as an **Approve** button only on pending requests
- **filters**, so a list shows only matching records, such as open deals or items below their reorder level
- **labels and messages**, such as "Saved Maria Rossi"

Formulas are deliberately simple. They can compare, combine and format values, and use a few ready-made helpers: today's date, the current time, formatting a date or an amount, counting the days or years since a date, adding days or months to a date (31 January plus a month is the end of February), the days between two dates, and the Monday of a date's week or the first of its month. Today's date follows the home's time zone, which owners and admins choose under **Apps** → **Look**; until they do, it's UTC.

Totals and charts can group a date field by **day**, **week**, **month** or **year**, such as sales by month, in time order and named like "Nov 2026".

A formula can't change anything, so a formula can never break your data. You can read the formulas of any screen in the app's details: **Screens**, then **View source**. They start with an equals sign.

### Calculated fields and named formulas

Two kinds of formula are kept apart from the screens, so they're written once:

- A **calculated field** belongs to a table: a field whose value is worked out from the same record's other fields, such as a total. Every app and bot of the home sees it. See [Calculated fields](/help/apps-data#calculated-fields).
- A **named formula** belongs to an app: a small calculation with a name, such as "with VAT", which any formula of that app can use, in lists, labels, show if and buttons. The app's details list them under **Logic**, with what each one takes, such as `with_vat(amount)`, and its formula.

Neither can go round in circles: the Builder can't save a calculated field worked out from itself, or a named formula that uses itself, even through others. A named formula that uses others, which use others in turn, stops with an error if one use sets off more than 1,000 of them. Filters run inside the database, so they can use neither; they use the fields themselves.

When a formula refers to a field that has been removed, it shows "—" instead of a value. A list whose filter uses a removed field shows no records, with the note "This list needs attention", rather than suddenly showing every record.

## Scripts

Some logic is too much for a formula: ranking leads by several measures, checking a booking doesn't overlap another, a nightly tidy-up, or fetching an exchange rate from another service. For these the Builder writes a **script**, a small program with its own tests.

You don't need to ask for a script. Describe what you want the app to do, and the Builder decides when one is needed.

### The five kinds

| Kind | What it does | Example |
|---|---|---|
| **Button** | Runs when someone presses a button. It can read and change records, then show a message, open a screen or open a dialog. | "Promote to customer" that updates a contact and its deals |
| **Screen data** | Supplies a screen with data that a filter can't express, for tables, totals, charts or single values. | A top-ten list of leads, scored across several tables |
| **Rule on saving** | Runs before records of a table are added or changed, whoever makes the change. It can refuse the save with a reason, or fill in fields. | "End date must be after start date" |
| **Formula function** | A small calculation the app's formulas can use by name. | Adding VAT to an amount |
| **Job** | Runs every 15 minutes, every hour, every day (or only on chosen weekdays), every week or every month (on a day such as the 1st, or the last day) at a set time, or when a table's records change, without waking a bot. | Each morning, mark overdue invoices |

A rule on saving knows who is making the change and their role in the home (owner, admin or member), or that it's a bot or a script. So an expense app can refuse anyone approving their own claim, and let only owners and admins approve. A button's or a job's script can ask the same about the person pressing the button or the job's person.

A rule on saving applies to every change to its table: from any app's screens, the Data tab, imports, bots and other scripts. So one rule protects the table everywhere.

## How the Builder writes a script

1. The Builder describes the job in precise words: what goes in, what to read or change, what comes out, and the awkward cases.
2. Mercbot's coding helper writes the code and a set of tests, and runs the tests in the same fenced-in space scripts always run in.
3. If a test fails, the failure goes back and the code is improved. This happens at most five times, within about a minute and a half.
4. The script is saved only if **every test passes**. Otherwise nothing is saved, and the Builder tries again with a clearer description.
5. Rules on saving and jobs start working as soon as they're saved. A new button, screen data or formula function takes effect once the Builder uses it in the app, through a draft you preview and publish as usual. A change to a script that's already in use, though, takes effect as soon as it's saved, without a new version of the app.

## The Logic tab

Open an app's details and choose **Logic**. Each script is listed with:

- a plain-language summary of what it does
- its kind, its short name, when it runs (for example "Before Leave requests records are added or changed", or "Every day at 07:30 (Europe/London)") and its version
- an **Off** chip if it's switched off, or a **Failing** chip if its last run failed

Open a script to see three views:

- **Code**: the script itself, read-only.
- **Tests**: each test with its input and the expected result.
- **Runs**: recent runs, each marked **OK** or **Failed**, with when it ran, how long it took, how many record or web calls it made, what started it, any error and anything the script noted down. The last 200 runs of each script are kept.

Below, you may see how the script was written, such as "round 1: 3 passed, 1 failed · round 2: 4 passed, 0 failed".

### Ask Builder to fix

Press **Ask Builder to fix**. The app's own chat with the Builder opens, with a first line naming the script, its summary and its latest error. Add what you noticed and send it. See [One chat per app](/help/apps-builder#one-chat-per-app).

### Turn a script off

A home's owners and admins see **Turn off** on each script. Use it when a script misbehaves:

- a switched-off **rule** stops checking saves, so a broken rule no longer blocks every save
- a switched-off **button** or **screen data** script says it's switched off where it would have run
- a switched-off **job** stops running

**Turn on** brings it back. Only the Builder removes a script, and only when you agree.

## Every script in the home

The **Scripts** tab in **Apps** lists every script in the home, with its app, its kind and its last run (**OK**, **Failed** or **Not yet**). Formula functions say **Runs in formulas**. It's the quickest place to spot a failing script.

## Safety limits

Scripts run sealed off from the rest of Mercbot. In plain words:

**What a script can reach**

- The home's tables, and only through the same checks as everyone else. Its changes are recorded in the activity trail under the script's name, and rules on saving apply to them.
- Outside web services, only at addresses the home's owners and admins have listed (below).
- Connected apps, bots and pictures, only those the home's owners and admins allowed for the app (below).

**What a script can't reach**

- your account, your chats, your files or your vault
- connected accounts, unless the home's owners and admins allowed the app to use them (above)
- the bots' computers and browsers
- any other website or service, and any private network address
- anything left over from an earlier run: every run starts fresh

**How much it can do in one run**

| Limit | Buttons and screens' data | Jobs | Rules on saving |
|---|---|---|---|
| Its own working time | 1 second | 5 seconds | Half a second |
| Memory | 32 MB | 32 MB | 16 MB |
| Longest run, including waiting | 30 seconds | 60 seconds | 10 seconds |
| Record calls | 50 reads and writes | 200 reads and writes | 20 reads (rules only read) |
| Web calls | 5 | 5 | None |
| Connected-app calls | 5 | 5 | None |

Formula functions are smaller still: a tenth of a second and 8 MB, with no record or web calls. If a script goes over a limit, the run stops and is marked **Failed** with the reason, such as using too much memory.

**All or nothing.** A run's changes to records are kept only if the whole run succeeds. If a script fails halfway, for example after adding two records and before updating a third, none of them stay, and neither does any bot work or picture it asked for. What it did outside the app can't be undone this way: a web call it made, or a change in a connected app such as a saved email draft. A job's own changes never set the same job off again, so a job can't trigger itself in a loop.

## Outside web services

The **Scripts** tab also has **Web addresses scripts may call**. Until something is on this list, scripts can't call any outside service.

A home's owners and admins can **Add an address**, such as `https://api.example.com`, then **Save**. Only secure (https) addresses are allowed. For services that need a key, use **Add a secret header** and enter its name and value. Mercbot adds the secret when a script calls that address. Scripts never see it, and it isn't shown again: the field says **Secret kept (type to replace)**.

Each call has 10 seconds and up to 1 MB of answer, and doesn't follow redirects to other addresses.

## Connected apps

Scripts can use the home's connected apps directly, with no bot in between: read mail in Gmail or Outlook, look at calendars, contacts, Google Drive, OneDrive, GitHub and Sedna, and use connectors such as Notion, Calendly and Todoist. They use the same connections, and the same rules, as the bots.

The app's **Logic** tab has **Connected apps its scripts may use**: a switch for each app connected in the home, and one for **AI: bots and pictures** (below). Until a home's owner or admin turns one on, the app's scripts can't use it. Members see the switches but can't change them.

- **Who it runs as.** A button or a screen uses the connected apps as the person using the app; a job, as the person who saved it or last turned it on. Connected accounts are the home's, so this mostly decides who the activity trail names. Sedna is the exception: it only ever sends as that person's own Sedna user. If that person leaves the home, the job stops using connected apps until someone turns it off and on again.
- **Only a button changes anything.** A button's script can save drafts, send, add events and change files. A screen's data and a job only read: anything else they try is refused, with a reason.
- **Your approval rules still apply.** A change your rules would ask about (sending an email, deleting something) isn't made straight away. The app asks you to confirm, saying exactly what will happen, such as *Shall I send the draft "Weekly update" to sam@example.com from Gmail?* **Confirm** makes it, as you; **Cancel** leaves it. A confirmation waits 15 minutes.
- **Never public.** An app that uses connected apps or AI stays inside the home: it can't be made public, and a public app can't be given either. Visitors never reach them.
- **Limits.** Up to 5 connected-app calls a run, and up to 1 MB in each answer.
- **Recorded.** Each change a script makes in a connected app is in the app's activity trail, with the app, the action and the person.
- **Files on email drafts.** A button's email draft in Gmail or Outlook can carry up to 3 of the records' files, 3 MB each, such as an invoice's PDF. They're read as the person pressing the button, so only files they can see go.

In a draft's preview, a button reads for real but only pretends to change anything, and the preview says what it would have done.

### Documents

A button's or a job's script can turn a record into a PDF and keep it in one of the record's file fields, such as an invoice with its lines, ready to download or attach to an email draft. The Builder writes the page: the record's values, shown as the app shows them, and a table of its line items. Up to 3 documents a run. In a draft's preview, nothing is made. Documents need the server's office apps; where they aren't installed, the button says so.

### Bots and pictures

With **AI: bots and pictures** on, a button's or a job's script can hand records to a bot and make pictures:

- **Hand items to a bot.** The script sends a task and a list of records with some text each; the bot works through them in one go (the home's main bot, unless the script names another) and writes each answer into a text field of its record as it finishes. Answers appear a moment later, not while the button runs. The bot answers from the text it was given only: it uses no tools, and anything an item's text says is treated as information, never as an instruction.
- **Make a picture.** The script describes a picture, which is made with the home's picture model and saved into a record's file or picture field. Pictures are checked as a bot's pictures are.

This is the same as a bot's work for that person: it goes through the home's usage and spending like any other. A screen's script can't use bots or pictures, since it would run every time someone opens the screen. Each run may hand over one list of up to 100 items, and ask for up to 5 pictures; an app has at most 3 lists waiting or in progress at once. The Logic tab lists the app's recent work: waiting, working with how many are done, done, or failed with the reason.

### Example: an "Urgent mail" app

Ask the Builder for an app that "checks my Gmail every hour, has the main bot judge whether each new email is urgent, shows the urgent ones, and draws a picture for one when I press a button". An owner or admin turns on **Gmail** and **AI: bots and pictures** in its Logic tab. Its job reads new mail, keeps each email once, and hands the new ones to the bot; its screen lists those the bot called urgent; its **Draw it** button asks for a picture.

## Watches and routines

Watches and routines belong to a bot in a chat, not to apps. A watch makes a bot act when records change, in the chat where you set it up, as the person who set it up, and you manage it on the bot's card. See [Bots working with app data](/help/apps-bots) and [Skills, routines and watches](/help/skills-and-routines).

## Questions

### Can I edit a script myself?
No. Scripts are only changed by the Builder, with tests. You can read everything about them.

### A rule is stopping every save. What do I do?
Ask an owner or admin to press **Turn off** on it in the Logic tab, then **Ask Builder to fix**.

### Why did my job not run?
Check its **Runs**. It may be switched off, or it may have failed with an error shown there.

## Related pages

- [Build an app with the Builder](/help/apps-builder)
- [Bots working with app data](/help/apps-bots)
- [Versions, activity and undoing changes](/help/apps-versions)
- [Security overview](/help/security)
