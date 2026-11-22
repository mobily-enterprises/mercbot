# Fixing common problems

This page goes through the problems people meet most often in Mercbot, one symptom at a time, with the usual causes and what to do. Find the heading that matches what you see. If nothing here helps, the last section lists what to gather before you contact support, so the problem can be found quickly.

## You're in the wrong home

If you have several homes, check which one is open with the switcher at the top of the sidebar. Each home has its own chats, people, bots, files and apps.

## Mercbot won't load or seems out of date

### The page stays on the loading screen

Select **Reload** on the loading screen. If it still doesn't start, check your internet connection, then try a private window or another browser. An out-of-date browser can stop Mercbot from starting; update it and try again.

### Your message or a reply seems lost

Mercbot retries messages and replies that were cut off by a brief connection drop, without sending them twice, and catches up when the connection returns. If a reply still doesn't appear after a minute or two, reload the page. Bots keep working on the server while you're away, so a reload never stops their work.

## A bot seems stuck or quiet

### A bot has been working for a long time

Some jobs take a while, especially ones that use several websites or make files. The status line tells you what the bot is doing. You can leave the page; the result will be in the chat when you come back.

Every job ends with a message. If a job fails, runs out of steps or takes too long, the bot posts its own account of what it did and what's still left to do. Reply to tell it how to carry on, or to try a different approach.

You can send another message while a bot is working. It gets its own reply once the bot has finished the current one.

### A chat says "Waiting for you" in the sidebar

An amber dot and **Waiting for you:** with a task mean a bot in that chat is waiting for you. Open the chat and look for a **Your turn** card, where it needs you to do a step on its computer in that chat, such as signing in. Select **Take over**, do the step, then **I'm done**, or select **Skip**. A card for someone else says whose turn it is, and only they can finish or skip it.

### A bot is waiting for an answer

Some bots ask a question and wait, sometimes with suggested answers to tap. Answer in the chat and it carries on.

### A bot didn't answer

If you mention bots with @, only those bots answer. When other people are in the chat, a bot answers only when it's called: by its name, with @, when you reply to one of its messages, or with @everyone. An archived bot never answers. See [Rooms, people and bots](/help/chats#who-answers).

### Replies come in the wrong language or time zone

Choose your language and time zone in **Settings** → **General**. These are kept on each device, so set them on your phone too if you use Mercbot there. Bots reply in the language you chose.

### A bot has forgotten something

Bots keep the thread of a long chat, but a new chat starts fresh. Bots made from a template keep what they learn about your job in a notes document in the chat's folder: open **Chat details** → **Files** to check it, and tell the bot what's missing or wrong. For something a bot should do in every chat, ask it to add it to its additions.

## The bot's computer

### The computer shows "Starting the desktop…"

Each bot has its own computer in each chat it's in. A computer goes to sleep when it hasn't been used for a few minutes, and wakes when it's needed. Waking takes a little while. Its website sign-ins and last open page are kept while it sleeps, and come back when it wakes.

### "Couldn't reach the screen"

The live view couldn't connect to the bot's computer. Select **Try again**. If it keeps happening, check your connection and reload the page.

### Websites behave strangely on the bot's computer

If a bot's browser keeps failing on sites that used to work, you can start the computers afresh. Open **Settings** → **Computer** and select **Reset**. It resets the bots' computers in the chats only you are in: their browsers close, and their saved sign-ins and website data are cleared. Chats with other people in them keep their computers. Your chats, routines and skills stay. After a reset, the bots will need to sign in to websites again.

## Websites and logins

### A bot can't sign in to a website

When a bot reaches a sign-in, it tries a login you gave it for the task, then the vault's login for that site, then a secure form in the chat, and finally hands you the screen. If it keeps failing:

- Check the saved login in **Settings** → **Vault**: is the website address right, and is the password current? Saved passwords can't be shown, so if in doubt, replace it.
- If the site sends a code by text message or email, the bot shows a secure form for the code. Type it there, not in the chat.
- If the site asks for something only a person can do, such as a puzzle or approving on your phone, the bot hands you the screen. Select **Take over** on the **Your turn** card.

Never paste passwords or card numbers into the chat. Bots don't need them there and will point you to the secure form or the vault instead.

### A bot keeps asking you to sign in to the same site

A sign-in stays on the bot's computer in that chat between jobs, but some websites sign people out after a while, and **Reset** in Settings clears them. A bot in another chat has another computer, so it signs in there again. Saving the login in the vault lets the bot sign in again without you, in any chat.

### A bot stopped just before buying or booking

That's on purpose. Bots stop before paying, ordering, booking, sending, cancelling, posting or inviting, and ask you first. Answer the approval in the chat, or finish the step yourself on the bot's computer.

## Connected apps

### An account says "Needs sign-in"

The account isn't signed in, or its sign-in has lapsed. In **Connect apps**, open the app and use the button on the account's line:

| Button | What happened | What to do |
|---|---|---|
| **Sign in again** | The sign-in lapsed, or the app stopped accepting it. | Sign in again and pick the same account. |
| **Sign in** | The account hasn't been signed in yet. | Sign in on the app's page that opens. |
| **Reconnect** | A sign-in was started but not finished. | Start again and complete it. |
| **Retry** | The last sign-in was cancelled or refused. | Try again, and allow access on the app's page. |

The sign-in window closes by itself once you're done, and the account shows **Connected**. If you signed in as a different address, nothing changes and the page says so: sign in again as the account's own address, or add the other one with **+ Add account**.

### An account says "Needs more access"

The app now asks for more access than when you signed in, for example full access to your files. The account still works with what it had. Select **Sign in again** and allow the new access to use everything.

### Your organisation has to approve the app

Some work accounts can't connect until the organisation's IT department approves Mercbot. The sign-in page then gives you an approval link to copy. Send it to your IT department, and sign in again once they've approved it.

### A bot uses the wrong account

If you have several accounts for one app, such as personal and work email, the bot asks which one to use and keeps to your answer in that chat. To change it, tell the bot which account you mean, by its label or address.

### You can't rename, sign in again or remove an account

An account's name, sign-in, pace and bin are for the person who added it and the home's owners and admins. Everyone else in the home can use the account and see its status. Ask whoever added it (its line says **Added by** *name*), or an owner or admin. **Remove from this home** works the same way: owners and admins can always remove an app, and the person who added it can while every account of it is one they added.

### A bot says sign-in codes in a mailbox are hidden

When a bot reads a mailbox someone else in the home connected, Mercbot hides the sign-in codes and sign-in links in it: a bot sees them only when the person who connected the mailbox is the one asking. Ask that person, or connect your own. Mercbot works this out from each email's wording, so it may also hide a code that isn't for signing in, such as a discount code; open the email yourself to see it.

### An account has gone from Connect apps

Someone who is no longer in the home takes the accounts they connected there with them: Mercbot signs them out and removes them, and the **Activity** tab in **Apps** lists each one. Connect the account again, or ask someone who uses it to. If it was the Google Drive the home's files were kept in, an owner or admin chooses where the files go again in **Settings → Files**.

### The app you want says "Coming soon"

Mercbot's connection to some apps is still being prepared. Select **Add** on the app to say you want it; it then shows **Requested**. Meanwhile, a bot can still use the app's website in its browser: just ask it.

### A bot says an action is switched off

Each connected app has a list of actions you can turn on and off. If a bot says something is switched off, open **Connect apps**, choose the app and look at its **Tools** list; it shows how many actions are enabled. Turn the action back on if you want the bot to do it. A switched-off action is also off on the app's website, so the bot won't work around it there.

### A sent email or invitation never arrived

On a test copy of Mercbot, such as one being tried out before it goes live, nothing is really sent. Emails, calendar invitations and answers, Drive sharing and comments, and GitHub comments, reviews, issues, pull requests, merges, releases and reruns of automation runs from connected accounts, and Mercbot's own sign-in emails, are written to its log instead, while the chat says they were done. A test copy shows a small tab at the top of every page naming where it runs, such as **Development**, **Test** or **Staging**, and whoever runs your Mercbot can tell you too. On the copy real people use, they arrive as usual.

## Approvals

### An approval is waiting

An approval card with **Go ahead** and **Don't do it** sits in the chat until you answer. Nothing happens until then. Only the person whose message started the work can answer it; for a routine, the person who set it up.

### Bots ask too often, or not often enough

Open **Settings** → **Permissions**. **Auto-review** makes your bots look over each action and ask first when it changes or sends something. Below it, add your own rules, one per kind of action, to **Always ask** or **Allow without asking**. When two rules disagree, asking first wins. Some actions, such as inviting people to a calendar event or commenting on GitHub, always ask first.

## A routine didn't run

Open the chat's **Chat details** and look under **Routines**, or open the bot's card. Then check:

- **Is it paused?** It says **Paused** and its switch is off. Anyone who can open the chat can pause a routine, but only the person who set it up can turn it back on. The next run is counted from then.
- **Is the time right?** When a bot sets up a routine, it tells you the schedule with its time zone. If the zone is wrong, ask the bot to change it.
- **Was there anything to report?** A routine told to report only news posts nothing when there's nothing new.
- **Was it a one-off?** A one-off reminder runs once, then is removed, with a line in the chat saying so.
- **Did it come from a template?** Routines from a bot template start paused until you say yes.
- **Was its bot archived?** Its routines pause, with a line in the chat. Resume the bot from its card (under **Archived bots** in the sidebar), then whoever set the routine up switches it on again.
- **Did the person who set it up leave the home?** Their routines pause, with a line in the chat, and no one else can resume them. Ask a bot to set up a new one.

Routines run at most every 10 minutes. If Mercbot was briefly unavailable, runs missed in that time happen once when it's back. If a run couldn't finish, the bot posts a short message saying so.

## Files and attachments

### A file won't attach

Each attachment can be up to 25 MB. Pictures in the HEIC format, used by some iPhones, aren't accepted; send them as JPEG or PNG.

A copy built on Mercbot may check every picture and video before it's kept or sent. If it says "This file can't be used.", that file can't be attached or uploaded there; if it says it can't be checked right now, try again in a few minutes.

### A file doesn't show a preview

The viewer shows pictures of up to the first 20 pages of a document, spreadsheet, slide deck or PDF, and shows pictures and plain text as they are. A file with no preview can still be downloaded from the viewer.

### You can't find a file

- Open the bot's card and choose **Library**. It lists everything that bot made, by day, in chats you can open.
- Press Ctrl+K and type part of the file's name. Search finds files bots made.
- What a bot makes in a chat is in that chat's folder: open **Chat details** → **Files**. If a bot in another chat can't see a file, ask a bot in the first chat to put it in the home's folder.
- If your home keeps its files in its own storage, files made before the change stay where they were.

### Files say the home's storage isn't answering

The home keeps its files in its own storage or in Google Drive, and it didn't answer. Try again in a few minutes. If it goes on, check the storage is online, or, for Google Drive, that Mercbot still has access in your Google account; if you removed it, the Files page asks you to sign in again within seconds.

### Files say Mercbot's folder is in Google Drive's bin, or the Drive is nearly full

Someone put Mercbot's folder in the bin of the Google Drive the home keeps its files in. What the bots save goes to the bin with it, and Google deletes it after 30 days. Take the folder out of the bin in Google Drive (open the bin, select the folder and **Restore**), or ask an owner or admin to select **Choose again** in **Settings → Files**, which makes a new folder. If the Drive is nearly full, free some space in Google Drive or get more from Google: once it's full, the bots' saves wait until there's room.

### Files say Google Drive needs signing in again

The home keeps its files in a Google Drive account whose sign-in ran out or whose access was removed in Google. The files are safe in Drive. Select **Sign in again** on the Files page or in **Settings → Files**, and sign in to the same Google account. If you can't, ask whoever connected that account: only they and the home's owners and admins can sign it in again.

## Spending

**Settings** → **Spending** shows what the bots in your home cost this month. Your bots run on Mercbot's own AI service, so there's no key for you to manage.

- **Every bot stops replying with an error at once.** The AI service may be unavailable: try again in a few minutes, and if it lasts, tell whoever runs your copy of Mercbot.

## Before you contact support

Gather these first, so the problem can be found quickly:

1. **What you were doing**, step by step, and what you expected to happen.
2. **What happened instead**, with the exact words of any error message.
3. **When it happened**, with the date, time and your time zone.
4. **Which home, chat and bot** were involved.
5. **The chat's ID.** Right-click the chat in the sidebar and choose **Copy chat ID**.
6. **Mercbot's version.** Open the account menu, choose **Help and support**, then **About Mercbot**, and select **Copy version info**.
7. **Your device and browser**, such as "Android phone, Chrome".
8. **What you've already tried**, such as reloading, signing in again or resetting the computer.

Then send them to whoever runs your copy of Mercbot. Never include passwords, card numbers or codes.

## Related pages

- [General questions and answers](/help/faq)
- [Rooms, people and bots](/help/chats)
- [The bots' computer and connected apps](/help/computer-and-apps)
- [The vault: saved logins and secrets](/help/vault)
- [Skills, routines and watches](/help/skills-and-routines)
- [Approvals, safety and privacy](/help/approvals-and-privacy)
- [Files, documents and pictures](/help/files)
