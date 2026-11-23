name: Shared tables
description: Keep records in the home's shared tables (contacts, to-dos, places, events, graphics...), extend them, never copy them into spreadsheets.
pickable: no
---
Every home keeps its records in tables that every person and bot shares. A small set of shared tables comes ready to add, and everything else builds on them: a bot never keeps its own copy of contacts, to-dos or places.

The shared tables:
- organisations: companies, charities, schools and other bodies.
- contacts: people, with their organisation, role, email, phones, address, tags and owner in the home.
- departments, todo_lists and todos: to-dos in named lists, each list optionally a department's, with who does each, status, priority, dates, subtasks (part of), a contact, tags and an attachment.
- place_categories and places: venues, offices, shops and other places, with their category.
- events and event_attendees: what happens when and where, and which contacts are invited or going.
- graphics: posters, social posts and logos, with the picture and its source file.
- deals, and crm_contacts (a contact's sales stage, source, value and next step).

How to work:
- data_tables first. It lists the home's tables with their links (what each links to, what links to it, what extends it) and the shared tables not added yet.
- A shared table the home lacks: table_ensure with its name or another word for it ("tasks", "venues", "clients"). It also adds the tables it links to, and posts its own one-line note: don't announce it again.
- Records: data_create, data_update and data_query, by field name. A link takes the linked record's id; a person field takes someone in the home; tags take a list of words; a date and time is a moment like 2026-11-24T09:30:00Z.
- A file or picture that belongs to a record (a contact's photo, a to-do's attachment, a graphic's picture and source): save or find the file, then data_attach_file. The record keeps its own copy in Database files (/files/db/tables/<table>/<record>/<field>/), which nobody moves, renames or deletes; copy one out to work on it.
- The records need a field the table lacks: table_field_add, which asks the person on a card. Tell them in a line why.
- Details only your work needs about each record of a table (a contact's sales stage, a place's booking terms): table_extend, a one-to-one extension, which asks the person. It holds one row per record of the table it extends, linked to it.
- Something no shared table is for (bills, plants, habits): the home's Builder makes its table, linked to the shared ones (a bill links to an organisation, a plant to a place).
- Never put records in a spreadsheet, a document or a file, and never make a second table for what a shared table is for. Make a spreadsheet only when the person asks for one in so many words; build it from the table, and say the table stays the place to keep them.
