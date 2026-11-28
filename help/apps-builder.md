# Build an app with the Builder

Every app in Mercbot is made by one bot: your home's Builder. You tell it what you need in ordinary words, it makes the tables and screens, and you try the result before anyone else sees it. This page walks through the whole journey, from choosing a Builder to changing an app months later, and explains what you can change yourself and what you ask the Builder for.

## The Builder role

The Builder is one of your ordinary bots with an extra job. Only the Builder changes how things are put together:

- tables and their fields
- apps, their screens and their navigation
- scripts, the small programs behind an app's harder logic
- an app's own styling

Every other bot, and every person, works with the records inside the tables. Only one bot in a home is the Builder at a time.

### Choose a Builder

There are two ways:

1. In **Apps**, press **New app**. Your home's main bot is its Builder unless an owner or admin picks another in **Settings** > **Main bot and Builder**.
2. Open **Settings** > **Main bot and Builder** and pick a bot under **Builder**.

Choosing the Builder is for the home's owners and admins. Anyone else who presses **New app** before there's a Builder is asked to get an owner or admin to choose one. An archived bot can't be the Builder.

### Move the role

To give the role to another bot, pick it under **Builder** in **Settings** > **Main bot and Builder**. Every app, table and record stays exactly where it is. Only the bot that makes changes is different. The Builder's card shows a **Builder** chip, with **Change in Settings →** for owners and admins. The Builder can't be archived until another bot takes the role.

## Ask for a new app

1. Open **Apps** and press **New app**. This opens your chat with the Builder, the one **Message** opens on its card.
2. Describe what you want, in your own words. For example: "I'd like a simple customer list with each customer's name, email, phone and whether they're a lead or a customer, and a screen of deals with a chart by stage."
3. The Builder looks at the tables your home already has and reuses them where it can. If you already have a customers table, a new app uses it rather than making a second one.
4. It makes any new tables and fields, then saves the app as a draft.
5. The Builder tries the draft itself: it opens each screen and uses every button and form that saves, with realistic example values, and checks the record turns up where it should. It fixes anything that fails before telling you.
6. A card appears in the chat, headed **App draft** with the app's name and a one-line summary of the change. It has two buttons: **Preview** and **Publish**. The Builder tells you in a line or two what it tried, and reminds you to press **Publish** to start using the app.

You can also ask any other bot for an app: "Get the Builder to make a plant watering tracker." That bot asks the Builder and waits. The Builder works from that request alone, its **App draft** card waits for you in the chat where you asked, and the first bot tells you when it's ready. See [Hand work from one bot to another](/help/messaging#hand-work-from-one-bot-to-another).

### Ask any bot for a database

Every bot knows what apps and databases are, and that only the Builder makes them. Ask another bot for "a database of my cats" and it won't quietly make a spreadsheet instead. It says the Builder (by name) makes databases, and offers a card to start a room with you, itself and the Builder. The card shows the room's name, whether it's **Private** (the default) or **Public**, who will be in it, and a short brief the bot wrote from your conversation. Nothing happens until you select **Go ahead**. Then the room is made with exactly those people and bots, the brief is its first message, addressed to the Builder with **@**, and the Builder answers it there by itself. **Open the room** on the card takes you there to carry on with the Builder. **Don't do it** makes nothing, and only you can answer your card. Once the database exists, the bot uses its tables like any other bot.

If you want a spreadsheet, say so ("put it in a spreadsheet"): the bot makes one, with no room. Your home's main bot is the Builder unless an owner or admin chooses another in **Settings** > **Main bot and Builder**.

You don't need to know which parts an app is made of. Say what you want to see and do, and let the Builder decide. If something you want needs more than screens and formulas, such as a rule checked on every save or a nightly job, the Builder writes a script for it by itself.

### Line items

Ask for line items wherever one record holds a list of others: an invoice or a quote and its lines, an order and its items, a trip and its stops. The record's screen then lists its own lines, with **Edit** (a small form in a dialog) and **Remove** on each, and a form below to add one, already linked to the record.

### Forms that do more

- **Files and pictures when adding a record.** Choose them in the form; they go on as soon as the record is saved. On a phone, a picture field also offers **Take a photo**. A public form can take up to 3 files of 10 MB each, if its app lets visitors add them.
- **"Are you sure?"** A button can ask first, in its own words, before it does anything, such as marking a record obsolete.
- **Buttons that branch.** A button can do one thing or another depending on what's in the form, such as asking for approval only for large orders.

### Boards, calendars and timelines

An app's screen can show records as cards you move around:

- A **board** has a column for each choice of a field, such as a deal's stage. Drag a card to another column, or use its **⋮** menu, and the record takes that choice.
- A **calendar** shows a month (or a week) with each record on the day of its date, such as visits or due dates. Drag a card to another day, or pick a date in its menu, and its date moves; an end date moves with it.
- A **timeline** shows four weeks, each record a bar from its start to its end, such as jobs or bookings, in lanes if you like (by crew, say). Move a bar and its start and end move together.

A move is an ordinary change of the record: if the table's rules refuse it (say, a deal can't be won without an amount), the card goes back and you're told why. On a phone, boards and timelines scroll sideways and a calendar shows one week as a list. Ask the Builder for one, for example "show deals as a board by stage".

## Preview, then publish

Every change to an app goes through two stages: draft, then publish.

**Preview** opens the draft in the app's own frame, on **practice data**, with a banner saying **Practice data: changes here are thrown away when you publish.** The banner has two buttons, **Reset** and **Publish**.

Practice data is a copy of your home's records, made when the draft is first opened, usually by the Builder as it checks the draft it saved. It holds the newest 1,000 records of each table the draft uses. The draft works on that copy just as the live app works on your records:

- **Save** adds or changes the record, and it shows in the lists, totals and charts at once.
- **Mark obsolete** and buttons that run scripts work too.
- Nothing leaves the app. A button that asks a bot doesn't send the task, and a script's web call that would change something elsewhere is only pretended. A note says what the live app would have done, for example "Practice data: nothing was sent. Once published, this would ask Otto."
- Your real records, the live app and **Activity** never see practice changes.

Press **Reset** to throw away every practice change and start again from a fresh copy of your records as they are now.

The practice data goes when you publish the draft, and when nobody has used it for 7 days. A new copy is made the next time someone opens the preview. Visitors to a public app never see practice data: they only ever see the live app.

When you're happy, press **Publish**, either on the banner or on the chat card. The draft becomes the next numbered version, and everyone who uses the app sees it. The card then says **Published as version 3**, or whichever number it is.

An app has at most one draft. If you ask for more changes before publishing, the Builder updates the same draft. A tile in **Apps** shows **Draft** while a change is waiting, and the tile's **⋮** menu has **Preview the draft**.

The Builder never publishes anything itself. Publishing, like restoring an older version, is always a person's choice. Anyone in the home who can use the app can publish it.

## Change an app later

Inside any app, the bar at the top has three tools.

### Ask Builder

Press **Ask Builder** on any screen. The app's own chat with the Builder opens (see [One chat per app](/help/apps-builder#one-chat-per-app)) with a first line already written, naming the app and the screen you were on. Finish the sentence, for example "…add a column for the customer's city", and send it.

### Point and ask

Press the pointer button next to **Ask Builder**. A note says **Click the part of the screen you want to ask the Builder about.** As you move the mouse, the part under it is outlined. Click a table, a form, a chart or a button, and the app's chat opens with that exact part named in the first line. This is the quickest way to say "change this".

### The app's details

The **ⓘ** button opens the app's details panel. It has six tabs: **Overview**, **Screens**, **Data**, **Logic**, **Versions** and **Activity**. Some of the details are covered below; versions and activity are on [Versions, activity and undoing changes](/help/apps-versions).

## One chat per app

If several apps are being built at once, talking about all of them in one chat gets confusing. So each app has its own chat with the Builder: **Ask Builder** in an app opens it. It's made the first time anyone asks, named after the app, with the Builder and the person who asked in it. It's a Public room, so everyone in the home can read it. If someone else started it, just write in it: writing joins you.

If the home picks another Builder later, the new one joins every app's chat by itself, and each chat shows a line saying so, for example "Chef is the Builder now, in place of Vera." The old Builder stays in the chat until someone removes it. See [Rooms, people and bots](/help/chats).

## What you can change yourself

You never edit an app's screens, formulas or scripts by hand. You can:

- add, edit and mark records obsolete, on the app's screens and in the **Data** tab
- publish a draft, and restore an earlier version
- remove a field, after seeing what uses it (see [Your data](/help/apps-data))
- pin apps to your sidebar
- change an app's picture and colour (below)
- pause or remove a bot's watches, on that bot's card

Everyone in the home can do all of this in every app and table: apps and their data belong to the whole home. The home's owners and admins also choose its settings:

- choose the Builder
- set an app's own colour and spacing in **Overview**, then **Save look**
- set the look of every app in the home in **Apps → Look**: colour, light or dark, font, corners, spacing and a logo. Colours that would make text hard to read are refused.
- install templates, switch scripts off and on, and choose which web addresses scripts may call

### An app's picture

Every app and view has a picture on its tile, drawn white on its colour: on the Apps home, in its own bar, in the sidebar and in its details. To change it, open the app's **⋮** menu on the Apps home and choose **Change picture**, or press **Change** beside **Picture** in the app's details. Pick a colour and a picture (**Search pictures** finds one by name, such as "receipt" or "pets"), then **Save**. Anyone in the home can change it, and the change is in the activity trail.

For a picture of the app's own, press **Ask the Builder to draw one**: the app's chat with the Builder opens with the request ready to send. The Builder draws it and puts it on the tile, where it replaces the set picture until you choose one again. Drawing a picture is a bot's work like any other picture it makes.

For anything about structure or appearance beyond that, ask the Builder. It can restyle an app completely, from layout and fonts to backgrounds and animation, so apps can look nothing like each other or like Mercbot.

## Read how an app works

You can look at everything without changing anything:

- **Overview** shows whether the app is internal or public, its live version, a link to its draft and how many screens it has.
- **Screens** lists each screen with its number of parts and queries. **View source** shows how the screen is described, in a read-only text form.
- **Data** lists the tables the app uses, with record counts. Each one opens in the Data area.
- **Logic** shows each script in plain words, with its code, tests and recent runs, and **Ask Builder to fix**. See [Logic: formulas, scripts and automations](/help/apps-logic).

## Limits worth knowing

| Limit | Value |
|---|---|
| Builders per home | 1 |
| Drafts per app | 1 |
| Screens per app | 40 |
| Parts per screen | 400 |
| Queries per screen | 12 |
| Records per page in a list (with pages after it) | 100 |
| Pinned apps per person | 8 |

A list of a table's records shows pages when it has more than a page's worth: **Previous page** and **Next page** buttons under it, with which records you're looking at, such as "101–200 of 250". Select a column's heading to sort by it, again to reverse the order, and a third time to go back to the screen's own order; columns worked out by a formula don't sort. A list can also have a search box, which looks in its text fields and keeps to the screen's own filter. Ask the Builder for one.

The Builder checks every draft before saving it. If something is wrong, such as a screen pointing at a field that doesn't exist, the draft isn't saved and the Builder fixes the problem first.

| Practice data | Value |
|---|---|
| Records copied per table | The newest 1,000 |
| Kept while unused | 7 days |

## If it doesn't work

- **"Choose a Builder first"** when you press **Ask Builder**: your home has no Builder, which happens only when it has no main bot. An owner or admin picks one in **Settings** > **Main bot and Builder**.
- **"This app hasn't been published yet."**: the app only has a draft. Open it with **Preview the draft** and publish it.
- **"This app has no draft."**: the draft was already published, or there wasn't one. You're looking at the live app.
- **"This practice data was just reset or cleared. Reload the preview to start again."**: someone pressed **Reset**, or the practice data was cleared after a week unused. Reload the page.
- **A record you added in the preview isn't in the live app**: that's expected. Practice changes stay in the practice data. Add the record again in the live app.
- **The card says "This draft has been published or replaced."**: someone published it, or the Builder saved a newer draft. Use the latest card or the app's tile.

## Questions

### Can I build an app without the Builder?
No. Apps and tables are always made by the Builder. You can start from a template, which the Builder or an owner or admin can install.

### Does the Builder change my records when it changes an app?
No. Changing screens never changes records. Removing a field asks a person first and keeps its data. When the Builder tries a draft, it only adds or changes practice data.

### Where are the example records the Builder made while trying the draft?
They are in the draft's practice data, so they show in the preview but not in the live app. Press **Reset** in the preview to remove them. They never reach your records.

### Can two people ask the Builder for changes at the same time?
Yes, but every change goes into the app's one draft, so check the preview before you publish.

## Related pages

- [Views: live figures from your home's data](/help/views)
- [Apps: what they are and when to use them](/help/apps)
- [Your data: tables, fields and records](/help/apps-data)
- [Versions, activity and undoing changes](/help/apps-versions)
- [App templates](/help/apps-templates)
- [Bots: add, shape and archive](/help/bots)
- [Rooms, people and bots](/help/chats)
