Build a small JSON HTTP API for notes in Node.js, as server.js, using only Node's built-in modules (no npm packages). It listens on the port in the PORT environment variable (default 3000) and keeps notes in the JSON file named by NOTES_FILE (default notes.json), so they survive a restart.

- POST /notes with {"title", "body", "tags"?}: title is a non-empty string of at most 100 characters, body a string, tags an optional array of strings. Creates the note and answers 201 with the note: {"id", "title", "body", "tags", "createdAt"} (ids are 1, 2, 3… and never reused; tags default to []; createdAt is an ISO date-time).
- GET /notes answers 200 with all notes, newest first. GET /notes?tag=x only those with that tag. GET /notes?q=word only those whose title or body contains it, ignoring case.
- GET /notes/:id answers 200 with the note.
- PATCH /notes/:id with any of title, body, tags (same rules) updates those and answers 200 with the note.
- DELETE /notes/:id answers 204.
- Errors answer JSON {"error": "..."}: 400 for invalid JSON or invalid fields, 404 for a note or route that doesn't exist.

Write tests for it with node:test that start the server on a free port with a temporary notes file, run them, and keep going until they pass.
