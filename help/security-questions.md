# Security questions and answers

Short answers to the questions security reviewers ask most, in three groups: isolation and what bots can reach; network and outside services; and approvals, logging and data. Each answer describes Mercbot as it is today. For the full picture, read the [Security overview](/help/security).

## Isolation and what bots can reach

### Can people in one home see another home's bots or data?

No. Bots, files, computers, Apps and usage all belong to a home, and a request for something in a home the person doesn't belong to answers "not found".

### Can owners and admins read members' chats?

No. Each person's chats with a private or mixed bot are their own. Only a shared bot's conversations are seen by everyone in the home, and the bot says so.

### Does a bot ever work on my own computer?

No. Bots work on their own computer in the cloud, a small desktop on one of Mercbot's servers. You can watch its screen and take control, but nothing runs on your device.

### What can a bot's browser reach?

The web, its own profile and the bot's file folders. It runs in a sandbox that sees none of Mercbot's own folders and only the parts of the system a browser needs. With private and mixed bots, each person has a separate browser, so sign-ins never cross between people. Its only way out is Mercbot's gateway, which connects only to public internet addresses, never to the server itself, its private network or cloud metadata addresses, and never to the ports used to send email.

## Network and outside services

### Which outside services does Mercbot talk to?

- The AI model providers, Together AI and DeepInfra (see [Which AI model is used, and can we choose?](#which-ai-model-is-used-and-can-we-choose)).
- Google, Microsoft, GitHub, Calendly, Notion and Todoist, for accounts people connect.
- Websites, through the bots' browsers.
- Optionally, when they are set up: Google's Gemini for pictures and for reading contact details from a photo in the vault, a home's own WebDAV storage, and the hub a copy is linked to.

### Can Apps scripts call the internet?

Only HTTPS addresses on the home's list, which owners and admins choose. Scripts can never call private addresses, don't follow redirects, and are limited to five calls per run, ten seconds and 1 MB per call. Secret headers are added by the server, and scripts never see them.

### Do the office apps have network access?

No. The apps bots use for documents, spreadsheets, slides and PDFs run in a sandbox with no network.

### Can bots reach our private company network?

Mercbot has no feature for that.

### Does a linked copy send our mail through its hub?

No. A copy linked to a hub only borrows its registered apps. The hub keeps the long-lived permission and hands the copy a short-lived key each hour; the copy then talks to Google, Microsoft or GitHub directly. Calendly, Notion and Todoist don't go through the hub at all: the copy registers itself with each app and keeps its own keys.

### Is there a list of fixed outgoing addresses to allow?

Mercbot doesn't publish one.

## Approvals, logging and data

### What does Auto-review check?

Each action a bot is about to take. Reading never asks. Actions that can be undone run unless one of your rules says otherwise. Sending, deleting, sharing, inviting, commenting and finishing a purchase or booking on a web page ask first on a card, unless your own message asked for exactly that. Your **Always ask** rules always win. If you turn the switch off, actions run unless an **Always ask** rule applies.

### Can an approval be changed after I approve it?

No. **Go ahead** runs exactly the action stored on the card, once.

### Can we see what bots did?

Yes. Every action leaves a line in the chat, and approval cards stay with their answers. In Apps, **Activity** shows every change to a home's records: who made it, where, and each value before and after. Apps scripts keep their last 200 runs.

### Can we plug in our own security tools?

Mercbot has no export of activity to outside security tools, and no policy hooks on model requests.

### Which AI model is used, and can we choose?

Mercbot runs one AI model at two providers: Together AI in the United States for chats, and DeepInfra for the Builder and for work nobody is waiting on, such as routines, watches and summaries of long conversations. Homes can't choose a different model, provider or region.

### Where is data kept?

In PostgreSQL and an encrypted file volume, wherever you run your copy. Together AI, which receives what a bot needs to answer in chats, runs in the United States. DeepInfra receives the same for the Builder's replies and background work.

### Can we run Mercbot ourselves?

Yes. It's a standard Node application on PostgreSQL that runs on your own Linux computer, for you alone. See [Running your own copy of Mercbot](/help/own-copy).

### Will people have to sign in to their apps again?

Only when a provider stops accepting Mercbot's key, or a sign-in is cancelled or refused. The account then shows as needing sign-in in **Connect apps**. Google Drive accounts connected before Mercbot asked for full Drive access need to be signed in again to change files Mercbot didn't make.

### What happens to a bot's computer when it shuts down?

When it sleeps or its server stops, the browser profile is sealed with the vault key and saved on the shared file volume, so sign-ins survive on any server. **Settings**, **Computer**, **Reset** clears it.

### Does Mercbot hold security certifications?

No. Mercbot doesn't claim any certifications or third-party audits.

## Asking something else

If your question isn't answered here or in the [Security overview](/help/security), ask whoever runs your copy of Mercbot.

## Related pages

- [Security overview](/help/security)
- [Approvals, safety and privacy](/help/approvals-and-privacy)
- [Homes: Mercbot for families and teams](/help/homes)
- [Running your own copy of Mercbot](/help/own-copy)
- [Apps: what they are and when to use them](/help/apps)
