# Versions, activity and undoing changes

Apps are built to be safe to change. Every published change to an app is kept as a version you can go back to, every change to your data is recorded with who made it, and nothing is ever deleted. This page explains versions, the activity trail, each record's history and the warning an app shows when part of it needs attention, and ends with a quick guide to undoing the most common changes.

## Versions in plain words

Each time someone publishes an app, it gets a new numbered version: version 1, version 2 and so on. The newest published version is the **live** one, the one everybody uses. Older versions are kept for good.

Each version carries a short summary of what changed, in plain words, written when the change was made. For example:

- the Builder's own description, such as "Added a city column to Contacts"
- "From the CRM template", for an app installed from a template
- "Restored version 2", after a restore

An app can also have one **draft**: changes the Builder has made that nobody has published yet. See [Build an app with the Builder](/help/apps-builder).

## The Versions tab

Open the app, press the details button and choose **Versions**. You'll see, newest first:

- **Draft**, if there's one waiting
- **Version 4 · live**, the version in use
- earlier versions, such as **Version 3**

Each line shows the summary, who made it and when. Older versions have a **Restore** button. The list starts with the 50 newest versions; when there are more, **Older versions** at the bottom shows the next 50. A view's **Versions** works the same way.

## Restore an earlier version

1. In **Versions**, press **Restore** next to the version you want.
2. Mercbot asks **Restore version 2? It becomes a new live version; nothing is lost.**
3. Press **Restore**. Mercbot confirms with **Restored as version 5**, or whichever number comes next.

Restoring copies the old version forward as a new one. The version you replaced stays in the list, so you can always restore it again. Restoring is always a person's action; bots can't do it.

What a restore brings back, and what it doesn't:

| Brought back | Not changed |
|---|---|
| The app's screens, navigation, formulas and buttons | Your records |
| Its public screens and visitor access (on a public app, only an owner or admin can restore wider access) | Your tables and fields |
| The Builder's styling for the app | Its scripts, which have their own versions and change only when the Builder saves them |
| | A waiting draft |
| | Settings such as its colour and spacing |

If a field has been removed since the old version, the restored app can't use it. The parts that needed it are hidden, and the app's health warning says so (below).

## The activity trail

The **Activity** tab in **Apps** shows every change in your home's apps and data, newest first. Each entry says:

- **who**: a person, a named bot, a script (by its summary) or a public visitor
- **what**: for example "added Contacts #12", "changed Deals #3" or "marked Items #40 obsolete"
- **where**: the app and screen, the **Data tab**, an **Import of** a named file, a **Chat**, **A watch**, **A task from a button**, or an app's **public form**
- **when**
- for added and changed records, each field's old value → new value

The trail also records changes to the apps themselves: a table created, a field added, renamed or removed, an app created, a version published, a bot made the Builder, and an app made public or internal again.

Changes made in a draft preview's practice data aren't in the trail: they never touch your records. See [Preview, then publish](/help/apps-builder#preview-then-publish).

### Filter the trail

Above the trail you can narrow it by:

- **Table**
- **App**
- **Who**: a particular person or bot
- **From** and **To** dates

Filters work together, so you can ask, for example, "what did the Sales bot change in Deals last week?" The trail shows recent entries first; press **Show older** at the bottom to go further back.

### One app's activity

Each app's details have their own **Activity** tab, showing only the data changes made through that app. It's the same trail, already filtered.

### One record's history

In the **Data** tab, open a record's **⋮** menu and choose **History** to see every change to that record alone. See [Your data: tables, fields and records](/help/apps-data).

## The health warning

An app's details panel shows a warning when part of it can't work. The most common is:

> 1 part of this app uses a removed field and is hidden. Ask the Builder to tidy the app.

This happens when an app version refers to a field that no longer exists, most often after restoring a version from before the field was removed. The app keeps working: it simply leaves those parts out, rather than showing errors.

To fix it, press **Ask Builder** and ask it to tidy the app. The Builder removes or replaces the hidden parts in a draft, and the warning goes once you publish.

### Other signs that something needs attention

- **A list says "This list needs attention".** It uses a field that has been removed, so Mercbot shows nothing rather than every record. Ask the Builder to tidy it.
- **A value shows "—".** A formula refers to a missing field, or the record has no value.
- **A link shows "(obsolete)".** The linked record has been marked obsolete.
- **A script shows Failing in the Logic tab.** See [Logic: formulas, scripts and automations](/help/apps-logic).

## Undoing common changes

| What happened | How to undo it |
|---|---|
| An app change you don't like was published | **Versions → Restore** the version before it |
| A record was marked obsolete | Data tab, **Show obsolete**, then **Restore** from the record's menu |
| A record was changed by mistake | Open its **History**, see the old values, and edit them back |
| A spreadsheet import added the wrong rows | Find them in **Activity**, listed as an import of your file, and mark them obsolete |
| A bot keeps reacting to changes it shouldn't | Pause or remove the watch in the bot's details |
| A field was removed | It can't be brought back as it was; its data is kept. Ask the Builder for a new field |

## Questions

### Does restoring a version lose the newer one?
No. Restoring adds a new version; every earlier version stays in the list.

### Can I see who changed a record if the person has left the home?
Yes. The activity trail keeps the name recorded at the time.

### Is the activity trail ever cleared?
No. Mercbot doesn't trim it: every change stays on record, just as records are never deleted.

## Related pages

- [Build an app with the Builder](/help/apps-builder)
- [Your data: tables, fields and records](/help/apps-data)
- [Logic: formulas, scripts and automations](/help/apps-logic)
- [Bots working with app data](/help/apps-bots)
