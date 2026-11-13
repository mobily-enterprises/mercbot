# Apps: what they are and when to use them

Apps are small working programs that your bots build for you, on your home's own data. You describe what you need in plain words, such as a customer list, a stock count, leave requests or a contact form for your website. Your home's Builder bot then makes the tables to hold the information and the screens to work with it. You don't write code or design anything yourself. This page explains what an app is, how apps fit into Mercbot, and what people usually build first.

## What an app is

An app is a set of screens on top of one or more tables of records. A stock app might have an **Items** screen that lists everything you keep, a screen for one item with a form to change it, and a chart of items by location. Behind it sits a table of items, with fields such as name, quantity and location.

Every app has:

- its own name, icon and colour
- its own navigation: a side rail or tabs on a computer, and a bar along the bottom on a phone
- real addresses, so you can bookmark a screen or a single record
- a details panel that shows how it's put together, its versions and what has changed through it

Apps can show lists and tables, forms for adding and editing, single records, totals and charts (bar, line or pie). Buttons can save changes, move between screens, or hand a job to one of your bots.

## Who builds them

One bot in each home holds the **Builder** role. It's an ordinary bot that you give the extra job of building apps. Only the Builder changes how apps and tables are put together. Your other bots work with the records inside them, and so do you.

When you ask for a change, the Builder saves it as a draft and tries it out. You preview the draft on practice data, a copy of your records where you can save and change things freely, and press **Publish** when you're happy. Nothing the Builder does reaches people until a person publishes it. See [Build an app with the Builder](/help/apps-builder).

## Internal and public apps

Every app is internal: everyone in your home uses it, such as a customer list, stock or leave requests. An app can also mark screens as public, such as a contact form or a booking page, with a visitor access list saying which records and fields visitors may reach. A copy of Mercbot that serves visitors without an account shows those screens, and only what that list allows. Everything else stays inside your home.

## One shared set of data

All the apps in a home share one set of tables. If your customer list and your invoices app both need customers, they use the same customers table, so a change in one shows in the other at once. The **Data** tab lists every table, how many records it holds and which apps use it.

Three rules hold everywhere:

- **Every change is recorded.** Whether a person, a bot, a script or a public visitor made it, the activity trail shows who changed what, where and when, with each field's old and new value.
- **Nothing is truly deleted.** Records are marked obsolete instead. They disappear from screens but stay in the table, and you can show them and bring them back.
- **Removed fields keep their data.** A field is only removed after a person sees what uses it and confirms. Its values are kept, and every app that used it is updated in one step, as a new version.

See [Your data: tables, fields and records](/help/apps-data) and [Versions, activity and undoing changes](/help/apps-versions).

## Where to find Apps

**Apps** sits near the top of the sidebar, just above your bots. Under it you'll see any apps you've pinned, each with its icon, so you can open them in one click. You can pin up to eight.

Opening Apps shows these tabs:

- **Apps**: a tile for each app, with its icon, name, an Internal or Public badge and when it last changed. A tile also shows **Draft** when there's a change waiting, and **Not published** for a new app that isn't live yet. The **⋮** menu on a tile pins it to the sidebar or previews its draft.
- **Data**: every table in the home.
- **Activity**: every change to the home's data and apps.
- **Templates**: ready-made apps to start from.
- **Scripts**: every script in the home, and the web addresses scripts may call.
- **Look**: the colours, font and logo your apps use.

The **New app** button opens a chat with your Builder. Inside an app, the back arrow at the top left takes you back to Apps, or to wherever you opened the app from.

## Apps and Connect apps

Mercbot uses the word "apps" for two different things:

- **Apps** (this section) are the apps your Builder makes, on data that lives in Mercbot.
- **Connect apps** is where you connect outside services, such as your email, calendar or file storage, so your bots can use them for you. See [The bots' computer and connected apps](/help/computer-and-apps).

Built apps don't connect to those services by themselves. A script can call an outside web service, but only at addresses your home's owners and admins have listed (see [Logic: formulas, scripts and automations](/help/apps-logic)).

## When an app is the right tool

An app is a good fit when:

- the same kind of information keeps coming back: people, orders, items, requests
- several people, or several bots, need to see and change it
- you want a form for people to fill in, inside your home or on the web
- you want a bot to react when something changes, such as a new enquiry

For a one-off question, just ask a bot in chat. For a task that repeats on a timetable, a routine may be simpler (see [Skills, routines and watches](/help/skills-and-routines)).

## Typical first apps

**Families**

- a household list of what's in the cupboard or freezer, with what to buy next
- chores, with who does what and when it was last done
- birthdays and addresses of family and friends

**Small businesses**

- a contact form for the website, with a list of what came in
- a simple customer list with deals and a chart by stage
- stock, showing when it's time to reorder
- bookings that customers make and change themselves

**Companies**

- leave requests that someone approves or declines
- a hiring pipeline with candidates by stage
- an internal requests or equipment list

Several of these exist as [App templates](/help/apps-templates), so you can start from one and ask the Builder to adapt it.

## Questions

### Do I need to know how to program?
No. You describe what you want and the Builder makes it. You can read how an app is put together, but you never edit it by hand.

### Can my other bots use the data?
Yes. Every bot in the home can read and add records, and can watch a table for changes. See [Bots working with app data](/help/apps-bots).

### Are apps shared between homes?
No. Each home has its own apps and its own data. See [Homes: Mercbot for families and teams](/help/homes).

## Related pages

- [Views: live figures from your home's data](views.md)
- [Build an app with the Builder](/help/apps-builder)
- [Your data: tables, fields and records](/help/apps-data)
- [App templates](/help/apps-templates)
- [Homes: Mercbot for families and teams](/help/homes)
