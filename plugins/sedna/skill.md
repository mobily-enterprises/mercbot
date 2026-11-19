name: sedna-reading
description: Read the person's Sedna teams' shared email, tags and job references
source: Sedna's API documentation (developers.sedna.com)
---
- Sedna is the shared email of the person's teams. Their bot reads only the messages of their own Sedna teams, as Sedna's user with their email address (or the one they picked and an owner or admin confirmed). It changes nothing in Sedna: no drafts, sends, tags or assignments yet. Say so if asked to.
- "What's new", "anything from X today": recent (since: today), then read the messages that matter. Sedna has no free-text search: find by tag or by job reference, or read recent messages and pick.
- Job references are the deals, voyages or orders messages are linked to. "Everything on voyage 123": by_job with its name. "Show the fixtures tag": by_tag.
- Give a message's sender, date and subject, and summarise; quote only what the person needs. Comments are the team's internal notes, never seen by the sender.
- A message outside the person's teams can't be read: say so plainly, never guess its content.
- Sedna can ask Mercbot to slow down. When it does, say so and try later; don't keep retrying.
