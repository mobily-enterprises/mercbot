# Logic: formulas, scripts and automations

Behind an app's screens there are a few moving parts: formulas that work out values on the fly, scripts the Builder writes for harder jobs, and automations that run when data changes or on a timetable. You never write any of these yourself, but you can always read them, see when they ran and what went wrong, and ask the Builder to fix them. This page is a reference for each, including the safety limits that keep scripts fenced in.

## Formulas

Formulas are short calculations inside an app. The Builder uses them for:

- **calculated values**, such as a person's age from a date of birth, or an amount shown as money
- **show if**, so a part only appears when it makes sense, such as an **Approve** button only on pending requests
- **filters**, so a list shows only matching records, such as open deals or items below their reorder level
- **labels and messages**, such as "Saved Maria Rossi"

Formulas are deliberately simple. They can compare, combine and format values, and use a few ready-made helpers: today's date, the current time, formatting a date or an amount, and counting the days or years since a date. Today's date and the current time follow UTC.

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
| **Job** | Runs every hour, day or week at a set time, or when a table's records change, without waking a bot. | Each morning, mark overdue invoices |

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

Press **Ask Builder to fix**. The Builder's chat opens with a first line naming the script, its summary and its latest error. Add what you noticed and send it.

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

**What a script can't reach**

- your account, your chats, your files, your vault or your connected accounts
- the bots' computers and browsers
- any other website or service, and any private network address
- anything left over from an earlier run: every run starts fresh

**How much it can do in one run**

| Limit | Most scripts | Rules on saving |
|---|---|---|
| Its own working time | 1 second | Half a second |
| Memory | 32 MB | 16 MB |
| Longest run, including waiting | 30 seconds | 10 seconds |
| Record calls | 50 reads and writes | 20 reads (rules only read) |
| Web calls | 5 | None |

Formula functions are smaller still: a tenth of a second and 8 MB, with no record or web calls. If a script goes over a limit, the run stops and is marked **Failed** with the reason, such as using too much memory. A job's own changes never set the same job off again, so a job can't trigger itself in a loop.

## Outside web services

The **Scripts** tab also has **Web addresses scripts may call**. Until something is on this list, scripts can't call any outside service.

A home's owners and admins can **Add an address**, such as `https://api.example.com`, then **Save**. Only secure (https) addresses are allowed. For services that need a key, use **Add a secret header** and enter its name and value. Mercbot adds the secret when a script calls that address. Scripts never see it, and it isn't shown again: the field says **Secret kept (type to replace)**.

Each call has 10 seconds and up to 1 MB of answer, and doesn't follow redirects to other addresses.

## Watches and routines

Watches and routines belong to bots, not to apps. A watch makes a bot act when records change, in the chat where you set it up, and you manage it in the bot's details. See [Bots working with app data](/help/apps-bots) and [Skills, routines and watches](/help/skills-and-routines).

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
