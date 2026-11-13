# Your data: tables, fields and records

Everything your apps show lives in your home's tables. A table holds records of one kind, such as contacts, items or leave requests, and each record has fields, such as a name, an email or a status. This page is a guide to the **Data** tab, where you see and edit every table directly, import and export spreadsheets, and see each record's history. It also explains why records are never deleted, and what happens when a field is renamed or removed.

## Tables and the Data tab

Open **Apps** and choose the **Data** tab. It lists every table in your home with:

- **Records**: how many live records it holds
- **Fields**: how many fields it has
- **Used by**: the apps that use it

Click a table to open it. If there are no tables yet, the Data tab says so: the Builder makes tables when it makes an app, or when you ask it to. All the apps in a home share these tables, so one table can serve several apps.

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

A field can also be required, so a record can't be saved without it. To see a table's fields, open the table and press **Fields**: each field is listed with its name and type.

You don't add fields yourself. Ask the Builder, for example "add a city field to contacts". It adds the field, and none of your apps are affected until it puts the field on a screen.

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

The Builder tells you this when it adds a calculated field. If you'll want to filter, sort or group by the value, for example a list of only the overdue ones or orders ranked by total, ask the Builder for a stored field instead. A rule fills it in every time a record is saved, so it can be filtered, sorted and grouped like any other field.

## Edit records in the spreadsheet view

An open table shows its records as rows, 25 to a page by default, with a column per field.

- **Search** looks for your words in every text, email, phone and choice field, ignoring capitals.
- Click a column heading to sort by it, and again to reverse.
- **New record** opens a form called **New in** and the table's name. Each field gets the right kind of input: a list for choices, a date picker for dates, a switch for yes/no, and a search list of records for links. Required fields are marked with an asterisk.
- Click a row to edit it. The form checks values as you type, and Mercbot checks them again when you press **Save**.
- The **⋮** menu at the end of each row has **Edit**, **History** and **Mark obsolete**.

Changes you make here are the same as changes made through an app's screens. They're checked the same way, and any rules the app has on saving still apply.

### Who can change a table

Everyone in the home can read and change every table's records, add to them, import into them and mark them obsolete, and so can every bot in the home. There is no setting to keep a table to some people. Every change is kept, with who made it, in the record's history.

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
- Amounts can be written as you'd write them, such as $1,250.50. Yes/no fields accept the usual yes and no words. Dates with a time keep only the day. A link can be given as the linked record's title.
- The activity trail shows each imported record as coming from an import of your file, by name.

## Export a table

Press **Export** and choose **CSV (.csv)** or **Excel (.xlsx)**. The file has one row per live record (not obsolete ones), field names as headings, amounts as ordinary numbers, links as the linked record's title and calculated fields as they're worked out now. An exported file can be imported back into the same table.

## Renaming and removing fields

Apps refer to each field by a permanent identity, not by its name, so fields can change safely.

**Renaming.** Ask the Builder to rename a field. Its new name shows at once in every app, every version, the Data tab and the activity trail. Scripts are the exception: they use fields by name, so a script that used the old name needs updating. Ask the Builder to update any script that uses the field; the **Logic** tab shows which scripts there are and whether their last run failed.

**Removing.** A field is never removed without a person checking first, whoever started it.

1. Press **Fields**, then **Remove…** next to the field. If the Builder suggests removing one, the same check appears as a card in its chat.
2. Mercbot lists every app that uses the field and how: as a column, a form field, a filter, a total and so on. Drafts are listed too.
3. If a list filters on the field, you're warned that without that condition the list will show more records. If calculated fields are worked out from it, you're warned that they'll show "—" until the Builder changes how they're worked out.
4. Press **Remove everywhere**, or **Keep it** to change your mind.

When you confirm, Mercbot does everything in one step: the field's data is kept, the field disappears from every app that used it, each of those apps gets a new version, and one entry goes in the activity trail. Past changes to the field still show in the activity trail, marked "(removed)". Scripts are never changed automatically; if one used the field, ask the Builder to update it.

A removed field can't be brought back as it was. If you need it again, ask the Builder for a new field.

## Nothing in a home is private

Nothing inside a home is hidden from its people. Everyone in a home sees every app and view, reads and changes every table in the Data tab, and every bot in the home can too. Anything that some members of the home must not read doesn't belong in the home's apps at all.

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
- [Homes: Mercbot for families and teams](/help/homes)
