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

Skills never contain passwords or codes. Your skills are yours: all your bots can use them in your own chats, but they're never used in a shared bot's conversation tabs.

A bot never runs a new skill until you ask. After saving one, it offers a test run.

### Pick a skill with /

In a bot's own chat, type **/** at the start of the message box. Up to five skills appear, your own first, each with its name and a short description. Keep typing to narrow the list, then use the arrow keys and **Enter** or **Tab** to choose. The skill becomes a coloured token in your message (**Backspace** removes it in one go). Add what you want and send, and the bot uses that skill for the job.

In a group chat, typing **@** also offers your own skills.

## Teach a task by showing it

Some jobs are easier to show than to explain. Do the task once on a bot's computer, and the bot turns the recording into a skill.

1. In the bot's own chat, select **+** next to the message box, then **Teach a task**.
2. The bot's computer opens with you in control. A banner says the recording is only used to learn the steps, then deleted.
3. Select **Start recording**. It's available once the screen is showing.
4. Do the whole task in the browser, the way you normally would. A red outline and a counting timer show it's recording.
5. Select the timer to stop and hand the recording to the bot.

The bot posts a short summary of the sites it saw, then writes up the skill. Its message links to the new skill, lists the steps, names the input (the part that changes each time, such as a search term or a date) and offers to try it. Steps that order, pay or send are marked "ask first".

A few things to know:

- Recording stops by itself after 10 minutes.
- Passwords and card numbers you type are never recorded.
- Select **×** on the banner during a recording to throw it away. Nothing is posted.
- The recording is deleted once the bot has learned from it.
- If the recording has no steps, or the bot can't learn from it, it explains why and doesn't make a skill.

Teaching isn't available in group chats, which have no computer.

## Manage your skills

Your skills are listed in **Connect apps**. Select the summary at the top (such as "3 connected") to open **Your apps and skills**, then look under **Private skills**. A skill link in the chat opens the same page.

- Change the skill's **Name**, **Description** or **Instructions**, then select **Save**.
- Select **Delete skill**, then **Delete for good?** to remove it.

Skills can't be shared on their own yet: the **Publish** menu says sharing skills is coming later.

## Routines

A routine is a job a bot repeats on a schedule. Ask for one in plain words in a bot's own chat:

- "Every weekday at 8am, summarise my unread email."
- "Every Friday afternoon, check the school website for new letters and only tell me if there's something new."

The bot adds a **Created routine** line with the routine's name, then tells you in plain words when it runs, in which time zone, and when the next run is. At that time it does the job on its own, even when you're away, posts the result in its chat and is marked unread.

If the instructions say to report only changes, and nothing has changed, the bot posts nothing at all for that run.

### When a run fails

A run that couldn't finish posts a short message saying so, and the routine tries again at its next scheduled time. If a routine fails five runs in a row, it pauses itself: the bot says so in its chat, with a **Paused routine** line, and the routine shows **Paused** in the Details panel. Resume it with its switch, or ask the bot to resume it, once whatever was wrong is fixed. A run that works, or resuming it, starts the count again.

If Mercbot restarts while a routine or a watch is running, another of its servers picks the run up where it got to and finishes it, once: you get one result, not two.

### Time zones

Routines use your time zone, which you can set in **Settings** > **General** > **Timezone**. You can name another one ("9am New York time"), and the bot confirms the zone each time it sets up or changes a routine.

### Once-only reminders

Ask for something once ("remind me in 20 minutes to call the dentist", "check the train times at 6pm tonight") and the bot sets up a one-off routine. After it runs, it removes itself and the chat shows **Routine finished and removed**. If it runs a little late, the bot says sorry briefly.

### Keeping an eye on a website

To watch a price, stock or a page for changes, ask for a routine that checks it. Before setting it up, the bot checks the thing now and tells you what it is today. It then says what will trigger an alert, and whether the routine should stop after alerting you.

## Manage routines

A bot's routines are listed in its **Details** panel, on the **Details** tab, each with its schedule and an on/off switch. You can also find a routine by name in the search palette (**Ctrl+K**).

- **Pause or resume:** use the switch, or right-click the routine and choose **Pause** or **Resume**. A paused routine shows **Paused**. When you resume it, the next run is counted from now; it doesn't catch up on runs it missed while paused.
- **Edit:** right-click and choose **Edit**. The message box fills with `Edit your routine "<name>": `. Type the change in plain words and send it. The bot confirms the new schedule.
- **Delete:** right-click and choose **Delete**, then confirm.

You can also just say it: "Pause the Monday summary".

### Routines that wait for your yes

A bot can set up a routine paused, so it doesn't run until you're ready. Bots made from templates do this: their setup interview creates the routines they need, paused, and they start only when you say yes. Ask for the same yourself: "Set it up, but don't start it yet." To start a paused routine, tell the bot to start it, or switch it on in the Details panel.

### Routines in shared bots and groups

A routine set up in a shared bot's conversation tab runs in that tab. In a group chat, a bot can set up its own routines; their **Created routine** lines and any approval cards go to that bot's own chat.

## Watches on app data

A watch tells a bot to act by itself when records in one of your home's tables change. Ask any bot in plain words, naming the table, what to look for and what to do:

- "When a new record is added to Orders, check whether we have the stock and tell me."
- "When stock in Products drops below 5, tell me which items to reorder."

A watch can look for **new records**, **changes**, or both, and can have a condition, such as a total over 500 or a status of Won. Each time it fires, the chat where you set it up shows **Watch:** with its name, followed by the bot's reply. One run covers up to 20 records and counts the rest.

Watches are listed in the bot's **Details** panel, under **Apps**, such as "Watches new records in Orders". Use the switch to pause or resume one, or **Remove** to delete it.

- A new or resumed watch only sees changes from that moment on.
- Changes the watch's own run makes never set it off again.
- A watch that runs more than 30 times in an hour pauses itself, and its bot tells you.
- What's in the records reaches the bot as information, never as instructions. Anything typed by visitors to a public app is marked as untrusted.

For buttons in an app that hand a bot a task, see [Logic: formulas, scripts and automations](/help/apps-logic).

## Test before you rely on it

- **Run it once by hand.** Before scheduling a job, ask the bot to do it now in the chat. Fix the instructions until the result is what you want, then ask for the routine.
- **Set it up paused.** Ask for the routine "but don't start it yet", check its schedule in the Details panel, then switch it on.
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

1. **Is it paused?** In the Details panel, a paused routine shows **Paused** and a watch's switch is off. A routine pauses itself after 5 failed runs in a row, and a watch after too many runs; its bot will have said so.
2. **Was it a one-off?** One-off routines remove themselves after running. Look for **Routine finished and removed** in the chat.
3. **Was there nothing new?** If the instructions say "only tell me if something changed", a run with no changes posts nothing.
4. **Check the time zone.** The bot confirmed the zone when it set up the routine. If it's wrong, check **Settings** > **General** > **Timezone** and ask the bot to change the routine.
5. **Did it fail?** A run that couldn't finish posts a short message saying so, and tries again at the next scheduled time. After 5 failures in a row the routine pauses until you resume it.
6. **Is it waiting for you?** A run that needs a sign-in, a payment or your approval stops and tells you, or leaves a card in the chat.
7. **Was Mercbot unavailable?** Runs missed while Mercbot was down are caught up with a single run once it's back.
8. **For a watch:** it only sees changes made after it was set up or resumed, and the record must match its condition.

## Automations you can trust

- **One job per routine.** "Monday summary" and "Friday reminder" are easier to check and change than one routine that does both.
- **Say what done looks like.** "A list of no more than five items, with links" beats "a summary".
- **Report only what matters.** Add "only tell me if something changed" to checks that usually find nothing.
- **Keep the stops.** Bots ask before paying, sending, booking or posting. Rather than allowing everything, let the bot draft and you approve.
- **Use your rules and switches.** Add an **Always ask** rule in **Settings** > **Permissions** for anything you always want to see first. Switch off actions you never want in **Connect apps** > **Tools**.
- **Check the first week.** Read the first few runs, and adjust the instructions in plain words.

## Questions

### Can my routine run while I'm signed out?

Yes. Routines and watches run on Mercbot's servers. Results wait in the bot's chat, marked unread.

### Can a routine send email without asking me?

Only if your instructions asked for exactly that, and none of your rules says to ask first. Otherwise the bot leaves an approval card or a draft for you to send.

## Related pages

- [Bots: create, shape, organise and remember](/help/bots)
- [The bots' computer and connected apps](/help/computer-and-apps)
- [Bots working with app data](/help/apps-bots)
- [Logic: formulas, scripts and automations](/help/apps-logic)
- [Approvals, safety and privacy](/help/approvals-and-privacy)
- [Fixing common problems](/help/troubleshooting)
