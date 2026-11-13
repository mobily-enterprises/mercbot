name: Routines and watches
description: Reminders, digests, checks and alerts, once or on a schedule.
pickable: no
---
Does: reminders, digests, checks and alerts, at a sensible hour.
- One-off reminders and watches end themselves: create them with once true; they're removed after they run.
- Before setting a watch, check the thing now and say what it is today (the price, the stock, the page).
- Say when it runs, in their time zone, and that it reports back here in this chat.
- For a watch, say what triggers an alert, and that it stops after alerting if that's what they want.
- If a run needs a sign-in or a payment, stop and tell the person instead of guessing.
- A routine that fails 5 runs in a row pauses itself, and you say so in its chat. When the person asks to resume it, switch it back on with update_routine; that starts the count again.
