# Skills, routines and watches

Once a bot has done a job well, you'll want it done the same way next time, and perhaps without asking. Mercbot has three tools for that. **Skills** are written-down ways of doing a task, which bots follow when it comes up. **Routines** run a job on a schedule, such as a Monday summary or a reminder in an hour. **Watches** let a bot act by itself when records in your home's Apps are added or change. This page explains each, how to test them, the limits, what to check when something didn't run, and how to set up automations you can trust.

## Skills

A skill is a short guide for one kind of task: when it applies, what it needs, the steps, and where to stop and ask.

### Mercbot's own skills

Every bot comes with Mercbot's own skills, covering everyday jobs such as **Shopping**, **Groceries**, **Flights**, **Places to stay**, **Restaurant booking**, **Rides**, **Job search**, **Scheduling**, **Slide decks**, **Making pictures**, **Writing as you**, **Getting through sign-ins**, **Paying and budgets** and **Documents, spreadsheets and PDFs**. There's also **What's new in Mercbot**, so you can ask any bot what has changed.

Bots know the whole list and read the right skill when a task calls for it.

### Your own skills

Your own skills sit beside Mercbot's. A bot makes one in two ways:

- **Saving one.** When a bot notices a job with several steps that will come back, it offers to save it as a skill. You can also ask: "Save what you just did as a skill called Weekly invoices." A bot only saves, changes or deletes a skill when you agree.
- **Learning by watching.** You do the task once on the bot's computer, and the bot writes it up (see the next section).

Skills never contain passwords or codes. Your skills are yours, in this home. A bot in a chat uses only what everyone who can open that chat can also open, so it uses your skills only in a Private chat where you're the only person. In any other chat it works from Mercbot's skills and its template's.

A skill isn't a bot's **Instructions**. A bot's instructions, on its card in **Team**, are its template and its own additions, the rules it follows in every reply, so keep the additions short; a skill is read only when its kind of job comes up, so it can hold long steps and reference material. A template can bring skills of its own, listed under its instructions. You can ask a bot to change its additions too: like a skill, it changes them only when you agree, on a card that shows the change. See [Bots](/help/bots).

A bot never runs a new skill until you ask. After saving one, it offers a test run.

### Pick a skill with /

In a chat with one bot, type **/** at the start of the message box. Up to five skills appear, your own first (only in a Private chat where you're the only person), then Mercbot's, each with its name and a short description. Keep typing to narrow the list, then use the arrow keys and **Enter** or **Tab** to choose. The skill becomes a token in the bot's colour (**Backspace** removes it in one go). Add what you want and send, and the bot uses that skill for the job. Remember that a bot can use your own skills only in a Private chat where you're the only person.

In a chat with more than one bot, **/** doesn't open a list. There, **@** names a bot, and you can ask for a skill in your own words, such as "use my Weekly invoices skill".

## Teach a task by showing it

Some jobs are easier to show than to explain. Do the task once on a bot's computer, and the bot turns the recording into a skill.

1. In a chat with one bot, select **+** next to the message box, then **Teach** and the bot's name, such as **Teach Chef a task**.
2. The bot's computer in that chat opens. A banner says the recording is only used to learn the steps, then deleted.
3. Select **Start recording**. It's available once the screen is showing. You take over the computer, and the chat shows a line saying so.
4. Do the whole task in the browser, the way you normally would. A red outline and a counting timer show it's recording.
5. Select the timer to stop and hand the recording, and the computer, back to the bot.

The bot posts a short summary of the sites it saw, then writes up the skill. Its message links to the new skill, lists the steps, names the input (the part that changes each time, such as a search term or a date) and offers to try it.

A few things to know:

- The computer belongs to the chat, so everyone who can open the chat can watch while you record. Teach a task in a Private chat if the task is only for you.
- Recording stops by itself after 10 minutes.
- Passwords and card numbers you type are never recorded.
- Select **×** on the banner during a recording to throw it away. No skill is made.
- The recording is deleted once the bot has learned from it.
- If the recording has no steps, or the bot can't learn from it, it explains why and doesn't make a skill.
- Steps that place an order, pay or send something are written as **Ask first:** in the skill it makes, so the bot asks you before doing them.

The skill it makes is yours, like any skill you save, so the bot uses it only in a Private chat where you're the only person.

## Manage your skills

Select **Skills** (the book) at the bottom of the sidebar, press **Ctrl+Alt+W**, or type "Skills" in the search palette (**Ctrl+K**): **Your apps and skills** opens at **Private skills**. In **Connect apps**, the summary at the top (such as "3 connected") opens the same page. Open a skill there to change it; a skill link in the chat opens it straight away.

- Change the skill's **Name**, **Description** or **Instructions**, then select **Save**.
- Select **Delete skill**, then **Delete for good?** to remove it.

Skills can't be shared on their own yet: the **Publish** menu says sharing skills is coming later.

## Routines

A routine is a job a bot repeats on a schedule. Ask for one in plain words in a chat:

- "Every weekday at 8am, summarise my unread email."
- "Every Friday afternoon, check the school website for new letters and only tell me if there's something new."

The bot adds a **Created routine** line with the routine's name, then tells you in plain words when it runs, in which time zone, and when the next run is. At that time it does the job on its own, even when you're away, posts the result in the chat where you set it up and marks the chat unread.

A routine belongs to its chat and runs as the person who asked for it, with their approvals. If that person leaves the home, or can no longer open the chat, the routine pauses, with a line in the chat.

If the instructions say to report only changes, and nothing has changed, the bot posts nothing at all for that run.

### Routines on new Sedna mail

A routine can work on the mail that comes into your Sedna teams, such as "every 15 minutes, tag new fixture recaps Fixtures, link them to their voyage and draft a reply for me to check." Each run reads only the mail that came in since its last run, in your own teams, oldest first. It can tag messages, link them to job references, write replies as draft cards for you to send, and post a summary. It never sends or assigns by itself unless one of your rules allows it.

A run looks at 10 new messages at most. If more came in, it says so and the next run carries on from there: nothing is skipped. A run that fails reads the same mail again next time, so it may tag a message or write a draft for it twice. Its first run starts from when the routine was made: older mail isn't new to it. What it reads and drafts shows in the chat it was set up in, for everyone who can open that chat.

### When a run fails

A run that couldn't finish posts a short message saying so, and the routine tries again at its next scheduled time. If a routine fails five runs in a row, it pauses itself: the bot says so in the chat, with a **Paused routine** line, and the routine shows **Paused** under **Routines** (see [Manage routines](/help/skills-and-routines#manage-routines)). Once whatever was wrong is fixed, the person who set it up can switch it back on, or ask the bot to resume it. A run that works, or resuming it, starts the count again.

If Mercbot restarts while a routine or a watch is running, another of its servers picks the run up where it got to and finishes it, once: you get one result, not two.

### Time zones

Routines use your time zone, which you can set in **Settings** > **General** > **Timezone**. You can name another one ("9am New York time"), and the bot confirms the zone each time it sets up or changes a routine.

### Once-only reminders

Ask for something once ("remind me in 20 minutes to call the dentist", "check the train times at 6pm tonight") and the bot sets up a one-off routine. After it runs, it removes itself and the chat shows **Routine finished and removed**. If it runs a little late, the bot says sorry briefly.

### Keeping an eye on a website

To watch a price, stock or a page for changes, ask for a routine that checks it. Before setting it up, the bot checks the thing now and tells you what it is today. It then says what will trigger an alert, and whether the routine should stop after alerting you.

## Manage routines

A chat's routines are listed in **Chat details**, the **ⓘ** button in the chat's header (**Ctrl+Alt+B**), under **Routines**. Each shows its name, its schedule (or **Paused**) and its bot, with a switch, a delete button, and an edit button on the routines you set up. In your chat with a bot, the one you open with **Message**, the **ⓘ** button opens that bot's card instead, and its **Details** tab lists the bot's routines in that chat.

A bot's card in **Team** lists its routines in every chat you can open, each naming its chat. Right-click one there for **Pause** and **Delete**, and on the ones you set up, **Resume** and **Edit**. You can also find a routine by name in the search palette (**Ctrl+K**), which opens its chat and the chat's details.

- **Pause or resume:** use the switch. Anyone who can open the chat can pause a routine; only the person who set it up can resume it, because it runs as them. A paused routine shows **Paused**. When it's resumed, the next run is counted from now; it doesn't catch up on runs it missed while paused.
- **Edit:** only the person who set the routine up can change it. The message box of the routine's chat fills with **Edit your routine "<name>":**. Type the change in plain words and send it. The bot confirms the new schedule.
- **Delete:** confirm **Delete** on the question that follows. The routine stops for good.

You can also just say it in the chat: "Pause the Monday summary".

### Routines that wait for your yes

A bot can set up a routine paused, so it doesn't run until you're ready. Bots made from templates do this: their setup interview creates the routines they need, paused, and they start only when you say yes. Ask for the same yourself: "Set it up, but don't start it yet." To start a paused routine, tell the bot to start it, or switch it on under **Routines**.

## Watches on app data

A watch tells a bot to act by itself when records in one of your home's tables change. Ask any bot in plain words, naming the table, what to look for and what to do:

- "When a new record is added to Orders, check whether we have the stock and tell me."
- "When stock in Products drops below 5, tell me which items to reorder."

A watch can look for **new records**, **changes**, or both, and can have a condition, such as a total over 500 or a status of Won. Each time it fires, the chat where you set it up shows **Watch:** with its name, followed by the bot's reply. One run covers up to 20 records and counts the rest.

Watches are listed on the bot's card in **Team**: open its **Details** tab, and the **Apps** section lists each of its watches in the chats you can open, such as "Watches new records in Orders". Use the switch to pause one, or to resume it if you set it up (it runs as you), or **Remove** to delete it. In a chat, you can also ask the bot "What are you watching here?": it knows its watches in that chat.

- A new or resumed watch only sees changes from that moment on.
- Changes the watch's own run makes never set it off again.
- A watch that runs more than 30 times in an hour pauses itself, and its bot tells you.
- A watch belongs to its chat and runs as the person who set it up. If they leave the home, or the bot is archived, it pauses, with a line in the chat.
- What's in the records reaches the bot as information, never as instructions. Anything typed by visitors to a public app is marked as untrusted.

For buttons in an app that hand a bot a task, see [Logic: formulas, scripts and automations](/help/apps-logic).

## Test before you rely on it

- **Run it once by hand.** Before scheduling a job, ask the bot to do it now in the chat. Fix the instructions until the result is what you want, then ask for the routine.
- **Set it up paused.** Ask for the routine "but don't start it yet", check its schedule under **Routines**, then switch it on.
- **Try a one-off first.** "Do this once in five minutes" shows you exactly what a run will post.
- **Start watches narrow.** Give a watch a clear condition, add a test record, and check what the bot does.

## Limits and usage

| Item | Limit |
| --- | --- |
| How often a routine runs | At most once every 10 minutes |
| A one-off routine | Removed after it runs |
| A routine that keeps failing | Pauses itself after 5 failed runs in a row |
| A watch | Pauses itself after more than 30 runs in an hour |
| One watch run | Shows up to 20 records; the rest are counted |
| A teaching recording | 10 minutes |

Routine runs, watch runs and skills are ordinary bot work, counted like any reply, computer days and commands included; **Settings** > **Spending** shows what they came to. A long job that runs out of time or steps ends with the bot's own account of what it did and what's left.

## Why didn't it run?

Check these in order:

1. **Is it paused?** Under **Routines**, a paused routine shows **Paused**; on the bot's card, a paused watch's switch is off. A routine pauses itself after 5 failed runs in a row, and a watch after too many runs; its bot will have said so. Routines and watches also pause when the bot is archived, or when the person who set them up leaves the home. A routine pauses, too, when the person who set it up can no longer open its chat.
2. **Was it a one-off?** One-off routines remove themselves after running. Look for **Routine finished and removed** in the chat.
3. **Was there nothing new?** If the instructions say "only tell me if something changed", a run with no changes posts nothing.
4. **Check the time zone.** The bot confirmed the zone when it set up the routine. If it's wrong, check **Settings** > **General** > **Timezone** and ask the bot to change the routine.
5. **Did it fail?** A run that couldn't finish posts a short message saying so, and tries again at the next scheduled time. After 5 failures in a row the routine pauses until the person who set it up resumes it.
6. **Is it waiting for you?** A run that needs a sign-in, a payment or your approval stops and tells you, or leaves a card in the chat.
7. **Was Mercbot unavailable?** Runs missed while Mercbot was down are caught up with a single run once it's back.
8. **For a watch:** it only sees changes made after it was set up or resumed, and the record must match its condition.

## Automations you can trust

- **One job per routine.** "Monday summary" and "Friday reminder" are easier to check and change than one routine that does both.
- **Say what done looks like.** "A list of no more than five items, with links" beats "a summary".
- **Report only what matters.** Add "only tell me if something changed" to checks that usually find nothing.
- **Keep the stops.** Bots ask before paying, sending, booking or posting. Rather than allowing everything, let the bot draft and you approve.
- **Use your rules and switches.** Add an **Always ask** rule in **Settings** > **Permissions** for anything you always want to see first. Your home's owners and admins can switch off actions nobody's bots should use, in **Connect apps**, under an app's **Tools**.
- **Check the first week.** Read the first few runs, and adjust the instructions in plain words.

## Questions

### Can my routine run while I'm signed out?

Yes. Routines and watches run on Mercbot's servers. Results wait in the chat, marked unread.

### Can a routine send email without asking me?

Only if your instructions asked for exactly that, and none of your rules says to ask first. Otherwise the bot leaves an approval card or a draft for you to send.

## Related pages

- [Bots: add, shape and archive](/help/bots)
- [The bots' computer and connected apps](/help/computer-and-apps)
- [Bots working with app data](/help/apps-bots)
- [Logic: formulas, scripts and automations](/help/apps-logic)
- [Approvals, safety and privacy](/help/approvals-and-privacy)
- [Fixing common problems](/help/troubleshooting)
