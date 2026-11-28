# Your data: tables, fields and records

Everything your apps show lives in your home's tables. A table holds records of one kind, such as contacts, items or leave requests, and each record has fields, such as a name, an email or a status. This page is a guide to the **Data** tab, where you see and edit every table directly, import and export spreadsheets, and see each record's history. It also explains why records are never deleted, and what happens when a field is renamed or removed.

## Tables and the Data tab

Open **Apps** and choose the **Data** tab. It lists every table in your home with:

- **Records**: how many live records it holds
- **Fields**: how many fields it has
- **Used by**: the apps that use it

Click a table to open it. At the top, a table shows what it **Links to**, what's **Linked from** it and what it's **Extended by**: click one to open that table. If there are no tables yet, the Data tab says so: the Builder makes tables when it makes an app, or when you ask it to. All the apps in a home share these tables, so one table can serve several apps.

## Shared tables

Every home builds on a small set of shared tables, so there's one list of contacts, to-dos or places for the whole home, whichever bot or app uses it:

- **Organisations** and **Contacts**: the people and organisations you deal with
- **Departments**, **To-do lists** and **To-dos**: who does what, by when, in which list
- **Place categories** and **Places**: venues, offices, shops and other places
- **Events** and **Event attendees**: what happens when and where, and who's going
- **Graphics**: posters, social posts and logos, with their pictures and source files
- **Deals**, and **CRM contacts**: each contact's sales stage, value and next step
- **List items**: the items of simple lists any app keeps, such as shopping, packing and wishes

A bot adds a shared table the first time it needs one, with the tables it links to, and says so in a line. It asks you first before adding a field, or an extension: a table that holds more about each record of another, one row per record, such as a contact's sales details. A bot never makes a second table for something a shared table is for, and never keeps records in a spreadsheet unless you ask for one. The **Templates** tab lists the shared tables, what each is for, and whether your home has it yet.

Every home starts with two apps on them, **Contacts** and **To-dos**, empty, ready to use.

### List items: one table for every simple list

Shopping lists, packing lists, wish lists and the like keep their items in the shared **List items** table, so a home doesn't grow a new table for each list. Each item says which **kind of list** it's on, such as "shopping" or "packing", and every app shows only its own kind: apps of the same kind share the list, so an item Meal planner adds is on the Shopping list too. An item can also say which named list it's on (a **List**, such as "Weekly shop"), and has general fields each app names its own way: quantity and unit, a group (an aisle, a category, who it's for), an amount, a due date, a person, a link, notes and a position. An app that needs more adds its own field to the table (Meal planner's meal), or a table of its own beside it. Every new home has List items from the start, empty; a home made before that gets it with its first list app.

You can also reach an app's tables from inside the app: open its details and choose the **Data** tab there.

## Field types

Each field has a type, which decides what it holds and how it's shown.

| Type | Holds | Shown as |
|---|---|---|
| Text | Any words | The text |
| Email | An email address, checked | The address |
| Phone | A phone number | The number |
| Choice | One of a fixed list, such as New, Won, Lost | The choice, often as a coloured chip |
| Link | A record in another table, such as a deal's contact | The linked record's title |
| Number | A number | The number |
| Money | An amount, kept exact to the cent | The amount with two decimals, such as 1,234.56 |
| Date | A day, without a time | The date |
| Yes/no | Yes or no | Yes or No |
| Date and time | A moment, such as 9:30 on 24 November | The date and time where you are |
| Person | Someone in your home | Their name, or "Former member" once they've left |
| Tags | A few short words, sometimes from a fixed list | The words |
| Web address | A link starting with http:// or https:// | The link |
| Long text | Notes of up to 20,000 characters | The notes |
| File | A document or any other file | Its name and size, as a link |
| Picture | A PNG, JPEG, GIF or WebP picture | A small picture (its name on a public screen) |

A field can also be required, so a record can't be saved without it. To see a table's fields, open the table and press **Fields**: each field is listed with its name and type.

You don't add fields yourself. Ask the Builder, for example "add a city field to contacts". It adds the field, and none of your apps are affected until it puts the field on a screen.

In an app's forms, a link field is a search list of the linked table's records too: type part of a title to find one. On a public form it lists only the records visitors may see, and a sign-up page about one event can link each sign-up to that event by itself.

A table can have up to five links. Choose them with care: a link can't be swapped for a sixth by removing one, as a removed field keeps its place.

A link can be **one to one**: each record of the other table has at most one record linked to it. That's how an extension holds more about each record of another table, such as a contact's sales details in **CRM contacts**.

### Files and pictures

To add a file or picture to a record, open the record and choose a file in its field: it's uploaded when you press **Save**. If a file can't go on (one over 150 MB, or a file that isn't a PNG, JPEG, GIF or WebP picture in a picture field), the record is still saved and the field says why: choose another file and press **Save** again. On an app's form for a record, it's uploaded as soon as you choose it, and the field says why if it can't be. **Remove** takes it away. A bot puts one of its files on a record when you ask it to.

A record's files live in your home's **Database files** folder, at a fixed place for each table, record and field. Anyone in the home can open and copy them, but nobody can move, rename or delete them there: they belong to their records. Replacing or removing a record's file deletes the old one; marking the record obsolete keeps it.

### Calculated fields

A calculated field is worked out from the record's other fields instead of being typed in, such as a total from price × quantity, a full name from first and last names, or an "overdue" flag from a due date. Ask the Builder for one, for example "add a total to orders, price times quantity".

- Its value is worked out again every time the record is shown, so it's always up to date: change the quantity and the total follows at once, everywhere.
- It shows like any other field, in apps' lists, records, totals and labels, and in the Data tab. **Fields** shows its formula, such as `calculated: =price * quantity`.
- Nobody types it in. In a form, and in **New record** or an edit in the Data tab, it's shown greyed out with **Calculated** under it, and it changes as you type the fields it's worked out from.
- Its value is worked out for every record shown, so it has to stay quick: it can't go through a list item by item or match a text against a pattern. A text longer than 10,000 characters, or a date that isn't one, shows "—".
- To change how it's worked out, ask the Builder. Every record shows the new value straight away, and the change is in the activity trail.

**What a calculated field can't do.** Because it isn't stored, Mercbot can't look through your records by it:

- **No filtering, sorting or grouping by it.** Apps' screens and totals, public tables, rule scripts and bots can't pick records by a calculated field, sort them by it or group them by it. In the Data tab its column can't be clicked to sort, search doesn't look in it, and a line under the search box says so. Filter or sort by the fields it's worked out from instead.
- **Sums and averages of up to 5,000 records.** A sum or average of a calculated field adds up at most 5,000 records. With more, Mercbot asks you to filter the list first.

A calculated number or amount worked out by adding, subtracting, multiplying or dividing other number fields, such as a total of price times quantity, can still filter and sort a list: orders over $100, or ranked by total. Other calculated fields, such as text, dates, yes/no or anything using a function, can't, and no calculated field can group totals. The Builder tells you this when it adds one. If you'll want to filter, sort or group by such a value, for example a list of only the overdue ones, ask the Builder for a stored field instead. A rule fills it in every time a record is saved, so it can be filtered, sorted and grouped like any other field.

A list can also compare two of a record's fields, such as items whose quantity is at or below their reorder level.

### Field checks

A field can check what goes into it, however a record is saved (an app's form, the Data tab, an import, a bot or a public form):

- **Smallest and largest**, for numbers, amounts and dates: an age of at least 18, a due date in this year.
- **A pattern**, for text and phone numbers: a 4-digit postcode, an order number like AB-1234.
- **Unique**, for text, emails, phone numbers, web addresses and numbers: no two records may share one. Capital letters don't make a difference.

Forms warn as you type. Ask the Builder to add checks, for example "member emails must be unique". If two records already share a value, the Builder tells you which, so you can change one first. Records saved before a check was added keep their values until they're next changed.

### Roll-ups

A roll-up adds up the records linked to a record, such as an invoice's total of its lines, the number of people signed up for an event, or a project's open tasks. Ask the Builder for one, for example "give invoices a total of their lines' amounts".

- It can be a **sum**, a **count**, the **smallest** or the **largest** of a field of the linked records, maybe only those matching a condition, such as lines that aren't done. Records marked obsolete don't count.
- It keeps itself up to date. Whenever a linked record is added, changed, moved to another record, marked obsolete or restored, from an app, the Data tab, an import or a bot, the total changes with it. A total of totals (a client's total of its invoices' totals) changes too.
- Nobody types it in. Forms and the Data tab show it greyed out, and an import skips its column.
- It's stored, so lists can filter, sort and group by it like any other field: invoices over $1,000, or events sorted by places taken.
- With no linked records, a sum or count is 0, and a smallest or largest is empty.

## Edit records in the spreadsheet view

An open table shows its records as rows, 25 to a page by default, with a column per field.

- **Search** looks for your words in every text, email, phone and choice field, ignoring capitals.
- Click a column heading to sort by it, and again to reverse.
- **New record** opens a form called **New in** and the table's name. Each field gets the right kind of input: a list for choices, a date picker for dates, a switch for yes/no, and a search list of records for links. Required fields are marked with an asterisk.
- Click a row to edit it. The form checks values as you type, and Mercbot checks them again when you press **Save**.
- The **⋮** menu at the end of each row has **Edit**, **History** and **Mark obsolete**.

Changes you make here are the same as changes made through an app's screens. They're checked the same way, and any rules the app has on saving still apply.

### Who can change a table

Unless a home's owner or admin has made a table private (see [Who can see a table](#who-can-see-a-table)), or it's each person's own (see [Tables that are each person's own](#tables-that-are-each-person-s-own)), everyone in the home can read and change its records, add to them, import into them and mark them obsolete, and so can every bot working for them. Every change is kept, with who made it, in the record's history.

## Related records

When you open a record, **Related** lists the records that link to it, table by table, with how many there are: a contact shows their to-dos, deals and sales details, for example. Each table's name opens that table. If they can't be read just then, **Related** says so, with **Try again**.

## Mark records obsolete instead of deleting

Mercbot never deletes a record. Instead, **Mark obsolete** hides it: it disappears from app screens and from the table, but every value is kept. Mercbot confirms with "Marked obsolete. It's hidden, not deleted."

To see hidden records, turn on **Show obsolete** above the table. Obsolete records appear greyed out with an **Obsolete** chip. To bring one back, open its **⋮** menu and choose **Restore**.

A record that links to an obsolete one still shows the link, marked "(obsolete)", so nothing silently disappears from other records.

## Each record's history

Choose **History** from a record's **⋮** menu. A panel opens with every change to that record, newest first:

- who made it: a person, a named bot, a script or a public visitor
- what they did: added it, changed it, marked it obsolete or restored it
- when
- for each field changed, the old value and the new one

The same changes appear in the home's activity trail, where you can search across all records. See [Versions, activity and undoing changes](/help/apps-versions).

The Data tab always shows your real records. Records added or changed in a draft preview are practice data, a copy that stays with the draft, so they don't show here. See [Preview, then publish](/help/apps-builder#preview-then-publish).

## Import a spreadsheet

You can add many records at once from a CSV file or an Excel file (.xlsx).

1. Open the table and press **Import**.
2. Choose the file. Its first row must name the fields, using either the names you see in Mercbot or the fields' short names.
3. Mercbot shows how many rows it found and which fields it will fill. Columns whose heading matches no field are listed as **Not used**, and so are columns for calculated fields, which are worked out again rather than imported. If a required field has no column, you're warned.
4. Press **Import** with the number of records.

What to know:

- Each row becomes a **new** record. Import never changes or replaces existing records.
- Every row is checked first. **If any row has a problem, nothing is added.** Mercbot lists the problem rows by their row number in your file, so you can fix them and try again.
- A large file goes in 500 rows at a time, every part checked before any is added. Only if a part fails as it's being added, for example because someone just took a value that must be unique, do the parts before it stay.
- Amounts can be written as you'd write them, such as $1,250.50. Yes/no fields accept the usual yes and no words. Dates with a time keep only the day. A link can be given as the linked record's title, and a person as their name. A date and time without a time zone is read as UTC.
- File and picture columns are left out: files go onto records one at a time.
- The activity trail shows each imported record as coming from an import of your file, by name.

## Export a table

Press **Export** and choose **CSV (.csv)** or **Excel (.xlsx)**. The file has one row per live record (not obsolete ones), field names as headings, amounts as ordinary numbers, links as the linked record's title and calculated fields as they're worked out now. An exported file can be imported back into the same table.

## Renaming and removing fields

Apps refer to each field by a permanent identity, not by its name, so fields can change safely.

**Renaming.** Ask the Builder to rename a field. Its new name shows at once in every app, every version, the Data tab and the activity trail. Scripts are the exception: they use fields by name, so a script that used the old name needs updating. Ask the Builder to update any script that uses the field; the **Logic** tab shows which scripts there are and whether their last run failed.

**Removing.** A field is never removed without a person checking first, whoever started it.

1. Press **Fields**, then **Remove…** next to the field. If the Builder suggests removing one, the same check appears as a card in the chat.
2. Mercbot lists every app that uses the field and how: as a column, a form field, a filter, a total and so on. Drafts are listed too.
3. If a list filters on the field, you're warned that without that condition the list will show more records. If calculated fields are worked out from it, you're warned that they'll show "—" until the Builder changes how they're worked out.
4. Press **Remove everywhere**, or **Keep it** to change your mind.

When you confirm, Mercbot does everything in one step: the field's data is kept, the field disappears from every app that used it, each of those apps gets a new version, and one entry goes in the activity trail. Past changes to the field still show in the activity trail, marked "(removed)". Scripts are never changed automatically; if one used the field, ask the Builder to update it.

A removed field can't be brought back as it was. If you need it again, ask the Builder for a new field.

## Tables that are each person's own

Some things belong to each person rather than to the whole home: their answers in a quiz, their progress in a course, their scores, their votes, their own checklist. A table can be made **each person's own** when it's made (ask the Builder for it, or a template brings one). Its records then belong to the person who added them:

- Everyone sees only their own records, everywhere: in an app's screens, its totals and charts, the lists you pick from in a form, search, the **Data** tab and its export. One screen shows each person their own progress.
- A record is always the person's who added it: Mercbot fills in its **Whose** field itself, and it never changes.
- Nobody else can open, change or mark obsolete your records, and that includes the home's owners and admins.
- A bot working for you sees only yours. An app's own jobs work for everyone, so they can see everyone's records, for example to tidy them up.
- A public app's visitors can't reach such a table, and the **Activity** trail shows what was in someone's records only to that person.

The Data tab marks such a table **Each person's own**. It can't be changed into a shared table, or back, later.

## Who can see a table

By default a table is the whole home's: everyone in the home can read and change its records, and so can every bot working for them. A home's owner or admin can make a table private: open it in the Data tab and press **Who can see it**.

- **Who can see its records:** everyone in the home, owners and admins only, or owners, admins and people you choose.
- **Who can change them:** the same choices, never wider than who can see them.

A private table shows **Private** next to its name. For anyone not chosen, its records are out of reach everywhere: in apps' screens, the Data tab and its search, export and import, bots (a bot works as the person it's helping), scripts and jobs (a job works as the person who turned it on). A link to one of its records shows only its number, a total worked out from it stays empty, and a list that reads it says it isn't available. Owners and admins can always see and change every table.

Public screens are different: visitors without a Mercbot account only reach what the app's visitor access lists.

## Questions

### Can I delete a table?
No. Tables, like records, are kept. If a table is no longer needed, ask the Builder to take it out of your apps; the table and its records stay in the Data tab.

### Why can't I edit a row?
It may be obsolete: restore it first.

### Does a bot's change look different from mine?
Only in who made it. The record's history and the activity trail name the bot.

### Why can't I sort by a calculated field?
It isn't stored: it's worked out each time a record is shown, so Mercbot can't sort, filter or group your records by it. Sort by the fields it's worked out from, or ask the Builder for a stored field instead. See [Calculated fields](#calculated-fields).

## Related pages

- [Apps: what they are and when to use them](/help/apps)
- [Bots working with app data](/help/apps-bots)
- [Logic: formulas, scripts and automations](/help/apps-logic)
- [Versions, activity and undoing changes](/help/apps-versions)
- [Homes: Mercbot for families and businesses](/help/homes)
