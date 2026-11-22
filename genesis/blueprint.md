# Blueprint

Mercbot is personal AI agents ("bots") that do real work for one person, as that
person's own copy on their own computer (D-81). Its technical direction is in
`docs/architecture.md`, and its decisions, which code cites as D-numbers, are in
`docs/decisions.md`.

The page shows an accessible loading shell before JavaScript initializes, with a
Reload link and an explanation if application initialization fails.

## Opening Mercbot

A copy has one person and no sign-in, registration or sign-out. It listens only
on the computer's own loopback address and opens with its secret key
(`mercbot open`), as Jupyter does; anything that comes without the key is
refused. Account settings cover profile, preferences (theme and accent), avatar
and notification choices.

## First run

The first time the person opens Mercbot they see three intro slides, then a short
transition, then their first bot (named Mercbot, black) runs a scripted
onboarding conversation: a greeting by first name, a choice of the bot's name,
a rename that shows everywhere at once, an explanation of how it works and a
suggestion to connect an app, with a single later reminder. Onboarding runs once
and its messages stay as ordinary history.

## Homes

Everything in Mercbot lives in a home: its people and bots, their chats, files and
computers. The person gets a first home the first time they open Mercbot, can create
more, and switches between them from the top of the sidebar. A home has one person, its
owner; nobody is invited in. A copy built on Mercbot that serves many people can
add invitations, roles and removals, and the rest of Mercbot already works for a
home with several people. A home's bots are its members exactly as its people are,
listed in the sidebar beside them; a bot differs in what it knows, and it is not a
sign-in account and holds no permission: approvals, settings and membership stay with
people, and a card is answered only by the person whose message started the work.
Everything happens in chats, which hold any of the home's people and bots: rooms, Public
or Private, that start with their maker and that people and bots are invited into, and
each person's private chats with one bot or one other person, which nothing else reads.
Every new room is Public, opened by everyone in the home now and later, and writing in
it joins it; whoever starts a room can choose Private instead, which only its members
open, and a chat never changes kind. One rule decides what a bot may use: in a chat, only what everyone who
can open that chat can also open, whether or not they have looked. What a bot makes in
a chat (files, pages, notes, routines, watches) belongs to that chat; putting it where
more people can open it takes a person's yes. Each bot has its own computer in each
chat it works in, labelled with its name; everyone who can open the chat can watch it,
take it over and hand it back, and use what is signed in on it, which the bot says in
one line when it signs in. When a home has several people, one chat holds everyone in
it, pinned first for each of them, and nobody leaves it. An archived bot is a member
who has left: it stays in its chats, greyed, never answers, its routines and watches
pause, and its maker or an owner or admin can resume it.
Connected accounts belong to the home they are connected in (a family
calendar, a team inbox, a person's Gmail): everyone in it, and their bots, use
them in any chat, and the person who added one and the home's owners and admins
change it. A bot sees sign-in codes and links only in mailboxes the person
asking connected, and someone who leaves a home takes the accounts they added there.
The AI behind the bots runs on the copy's own provider keys, one for each of
Mercbot's three kinds of AI (D-72). There are no plans: what the bots use (their
AI, pictures, a computer's days and commands) is counted for its home, person
and bot, with what each AI call cost at its provider (a computer's days and
commands cost nothing), and every bot shows what it cost this month. Spending is
only reported: nothing is ever paused or refused because of it.

## Bots and chat

An open home is the Mercbot shell: a dense, resizable sidebar (or compact rail)
with pinned chats, then Rooms (the person's own, grouped into their sections and
sorted by latest activity, then the public rooms they aren't in, faded), People and
Bots, each section folding away and each with its + — with unread and mention marks,
drafts, right-click menus and drag and drop; and the
chat with a header showing its members and whether it is Public or Private, a
composer that says who can read it, and its details. Chats persist. Anything
the person types gets a reply from the chat's bots: a status line
describes the work, then the whole reply arrives as rich text. People can react,
reply to and copy messages, attach files, quote selected text, and find text in
a chat. Bots make and edit documents, spreadsheets, presentations and PDFs with
office apps that run out of sight; each file they save arrives as a card in the
chat that opens a viewer with a download. Bots also write pages (an invitation,
a plan, a guide) that open in place of the chat; the person can publish a
page to their own website, a folder a web server already serves or
S3-compatible storage, set up once in Settings → Website, which shows the page without its scripts. What a bot saves in a chat is in that
chat's folder; the bot's own folder and the home's folder hold what is meant to reach further. Each bot has its own expressive avatar. People add more bots with Add bots: they describe what they need and check the bots Mercbot suggests, or choose one bot, with a name, shape and colour, or a ready-made set; new
bots appear under Bots, and each greets the person in their chat with it and asks what to help with first. Connect apps lists the integrations Mercbot offers by category, with search;
people can add or remove them and see which still need signing in, and manage
their own skills. A bot's card (the details of a person's chat with it)
lets people rename a
bot, read the template it follows (from Mercbot's library or the home's own, shown as a tag beside its
name everywhere) and change it, write its additions, the rules for that bot alone on top of its template
(its maker and the home's owners and admins; a bot also changes its additions when asked, on a card the
person approves), and give it Knowledge. A chat's details list its members, its files
and its routines, which people pause, resume, edit or delete there.
People ask a bot in plain words to do something on a schedule; it sets up a
routine, says when it will run with the time zone, and then runs it on its own
while they are away, posting the result in the chat and marking it unread. A routine runs as the person
who asked for it. Opening a chat shows a "new" divider above what arrived since the last visit.
People can teach a bot a task by recording themselves doing it on the bot's
computer; the bot saves the steps as the person's own skill, which a bot uses only in a Private
chat whose only person is them.
A chat can hold several bots and people: with one person in it, every bot answers in
turn (or only the ones mentioned with @); with several people, a bot answers when it is
named, mentioned, replied to or asked with @everyone, or, when the chat lets bots join
in (off unless its maker or an admin switches it on), when one bot can help with a
message nobody called it for; and bots can answer each other once. In a chat with two
or more bots, a person can have them discuss a question, a round at a time on a card
that says first what it may cost and never spends more, with each round, the wrap-up
and Stop on the person's press. Bots ask each other for work on a brief, and the answer
comes back to the chat that asked.
However long a chat gets, a bot keeps its thread: in the background it keeps a
summary of the older part (what was asked and decided, facts, what it did and
promised, what's still open) and reads everything since word for word.
A search palette (Ctrl+K) finds chats, bots, apps, settings, routines and
messages. The account menu shows this month's spending and offers help and an
About box.
People can dictate into the message box and hold voice conversations with a bot,
which listens, replies aloud and leaves the conversation in the chat.
Mercbot runs as a standard Node application on PostgreSQL and can run as several
servers behind a proxy (D-15). Global keyboard
shortcuts and a shortcuts sheet are available; features not built yet open
placeholders.

## Apps

Each home has Apps: small apps its bots build on the home's own data, such as a
contacts list, a stock tracker or a sales pipeline. One bot is the home's
Builder: people ask it for an app or a change, it prepares a draft, and a person
previews it and publishes it. The Builder looks the part: at rest its face is
thinking, eyes up to one side under a raised brow. Apps open from the sidebar (people pin the ones
they use) in their own frame with their own screens, lists, forms, totals and
dialogs. Every bot can read and add to the same data from chat. The Apps area
also shows the home's tables as spreadsheets, which can be exported to CSV or
Excel and filled from a CSV or Excel file (all rows or none), and an activity
feed of every change: who made it, where, and what each value was before and after. Nothing is
ever deleted: records are marked obsolete and can come back. Renaming a field
changes it everywhere; removing one shows first what it affects, keeps its data,
and updates every app in one go. Earlier versions of an app can be restored.
Any bot can also make a view at once, with no publishing: live figures from the
home's tables, such as a list, a total or a chart, that stay up to date while
open. Every view is the whole home's from the moment it's saved, whichever chat
asked for it. An app can show a view two ways: shared, so one change reaches every
app using it, or as its own copy, which asks whether to update when the original
changes. Pages stay for written content.
Apps can show charts, and their buttons can hand a task to a bot, which works on
it in its chat. Any bot can be asked to watch a table and act by itself when
records are added or change. An app can have rules about what people from outside
the home may read, add or edit: Mercbot keeps those rules and holds every
visitor's request to them, and a copy built on Mercbot that serves visitors can
make the app public at its own address.

Nothing inside a home is private: everyone in it sees every app and view and
changes every table, and public apps, where they are served, are the only way in from outside. A home picks how its apps look (colour,
light or dark, font, corners, spacing, logo), and each app can change its colour
and spacing. Beyond that, the Builder can give any app a completely different
look of its own, with its own style sheet, without ever touching Mercbot around
it. Ready-made templates (CRM, Stock, Leave requests, Hiring pipeline,
Contact form, Bookings) install as drafts.

When an app needs logic that formulas can't express, the Builder writes a script
with its tests, without being asked to: a button that does a job, data worked out
for a screen (a ranking, a summary across tables), a rule checked before every
save wherever the change comes from, a function the app's formulas use, or a job
that runs every hour, day or week or when records change. Scripts run sealed off
with strict limits, change records only through the same checked, audited path as
everything else, and reach outside web services only at addresses the home's
owners allow, whose secret keys scripts never see. People read each script, its
tests and its recent runs in the app's Logic tab, and every script of the home in
the Apps Scripts tab.

Pages open directly on useful content and actions without introductory title
blocks.
