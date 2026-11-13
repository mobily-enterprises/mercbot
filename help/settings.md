# Settings and notifications

Settings is where you choose how Mercbot looks and behaves for you, manage your home's files, reset your bots' computers, and keep your vault. This page goes through Settings section by section, then your account details and each bot's own options. It ends with how Mercbot shows that a bot needs you, what it does about notifications, and how errors appear.

## Open and close Settings

- Open the account menu and choose **Settings**, or press **Ctrl+,**.
- In the search palette (**Ctrl+K**), type "Settings" to jump straight to a section, such as **Settings: Vault**.
- **See spending** in the account menu opens **Spending**.

Settings opens over the app, with the sections listed on the left: **General**, **Computer**, **Permissions**, **Files**, **Memory**, **Vault**, **Spending**, **Mercbot account** and **About**. Close it with **×**, **Escape** or a click outside. On a phone, Settings fills the screen and shows one section at a time; **All settings** at the top returns to the list.

Most controls apply as soon as you change them. The exceptions say so: forms in **Files** and the **Vault** have their own **Save** button.

## General

### Account

Your name and email address, with a button to copy the email. **Account details** opens your account page (see below). There's no **Sign out**: Mercbot opens with `mercbot open` (see [Running your own copy of Mercbot](/help/own-copy)).

### Appearance

- **Theme:** **Follow system**, **Light** or **Dark**. It's saved to your account, so it follows you to other devices.
- **Accent:** the colour of your messages and the send button: **Bot colour** or **Black**.
- **Language:** your bots reply in this language. The list can be searched, and shows each language in its own words with the English name beside it.
- **Spell check while typing:** for the message box.

### System

**Microphone:** the microphone used for dictation and voice conversations.

### Bots

- **Timezone:** used for routines and the times your bots mention. The list can be searched and shows the time now in each zone.

Language, accent, timezone, spell check and microphone are kept on the device you're using. Set them on each computer or phone you use.

## Permissions

- **Auto-review:** when it's on, your bots review each action against your rules before doing it, and ask you first when it changes or sends something.
- **Always ask:** actions that fit one of these rules always stop for your yes.
- **Allow without asking:** actions that fit one of these rules go ahead without a card.

Select **Add rule** beside a list, describe one kind of action in plain words (for example "set up a weekly reminder") and choose **Add**. The **×** beside a rule deletes it. If two rules disagree, asking wins. Your rules are yours alone, and Mercbot's own safety checks always apply on top. See [Approvals, safety and privacy](/help/approvals-and-privacy).

## Files and Website

### Files

Where the home keeps its bots' files:

- **On Mercbot:** Mercbot keeps the files for you.
- **In Google Drive:** choose one of the Google Drive accounts connected in Connect apps, yours or the home's, and select **Save**. Mercbot makes one folder there, named after the home, and keeps the files in it. With no account connected yet, **Connect Google Drive** opens Connect apps. If the account needs signing in again, this section says so and, for whoever can, shows **Sign in again**. It also shows the Drive's free space and warns when less than 1 GB is free. If Mercbot's folder is in Drive's bin (or was deleted), it says so: what the bots save goes to the bin with it, and Google deletes the bin's files after 30 days. Take the folder out of the bin in Google Drive, or select **Choose again** to have Mercbot make a new folder in the same Drive and move the files into it.
- **In the home's own storage:** Nextcloud or any storage with a WebDAV address. Fill in the **Address**, **Username** and **Password**, tick **It's Nextcloud** if it is, and select **Save**. Mercbot checks the storage before saving the choice, and the files live there in a Mercbot folder.

Saving another place moves all the home's files there, every time, and the new place becomes an exact copy of them: whatever was there before is replaced. This section shows the move as it goes, with **Cancel** until it's done. Meanwhile the files can be read but not changed, and the bots' computers sleep; a command a bot started before the move is waited for (at most 30 minutes), as it may still save files. Once it's done, a Google Drive folder left behind goes to that Drive's bin, where Google keeps it for 30 days, and Mercbot's own copy is deleted; a copy in the home's own storage stays. A move that's cancelled or fails leaves the files where they were and says why. If the files can't be read where they are, for example in a Google Drive that needs signing in again, Mercbot says so and offers **Switch without the files**, which leaves them there.

Only owners and admins can change this. See [Files, documents and pictures](/help/files).

### Website

Where the home's pages are published, if you have a website of your own:

- **A folder on this computer:** a folder a web server already serves. Enter its whole **Folder** path, such as `/var/www/html/pages`. Only the people who run this copy of Mercbot are offered it, as Mercbot writes there with the computer's own rights; on Mercbot on your own computer, that's you.
- **S3-compatible storage:** Amazon S3, Cloudflare R2, Backblaze B2, MinIO and the like. Enter the **Endpoint** (empty for Amazon S3), the **Bucket**, its **Region**, an optional **Folder in the bucket**, and an **Access key** and its **Secret** that may list, read, write and delete in the bucket. Unless you run this copy of Mercbot, the storage and the website's address must be on the internet: an address on a private network, such as `localhost`, `192.168.…` or `10.…`, is refused.

Then enter **Its address on the web**: where the web server serves that folder, such as `https://example.com/pages/`. Select **Save**: Mercbot checks the folder or the bucket before saving, and says what's wrong if it can't use it. The access key and secret are kept locked with the vault's key and never shown again; leave them empty to keep the saved ones.

Each page you publish goes in a folder of its own there, at the address followed by the page's name. Mercbot only ever replaces or removes folders it put there itself. While pages are published, the folder or bucket can't be changed and **Remove website** is refused: unpublish them first. A new address or place asks for confirmation again at its next first publish. Only owners and admins set this up. See [Publish a page to your website](/help/files).

## Computer, Memory and Vault

### Computer

- **Update** shows **Up to date**. Your bots' browsers are kept up to date for you, and updating keeps their saved sign-ins.
- **Reset** starts every bot's computer afresh. Open pages close, and saved sign-ins and website data are cleared. Your chats, routines and skills stay. Mercbot asks first.

See [The bots' computer and connected apps](/help/computer-and-apps).

### Memory

**What your bots remember about you:** the lasting facts you've told your bots, such as an allergy or a preference. All your bots know them. Select **×** next to a fact to make your bots forget it. Only these facts are shared between your bots; your chats with each bot stay private.

### Vault

Your saved logins, cards and contact info, with tabs, search, **New item** and a delete button on each row. See [The vault: saved logins and secrets](/help/vault).

## Spending

**Spending** shows what your bots' work cost at the AI providers, on the keys this copy of Mercbot uses. It only reports: nothing is ever paused or refused because of what was spent.

- **This month:** the whole home's spending so far for owners and admins, and your own use for members (what the home's bots did for you).
- **Spending:** a report of a **Day**, a **Week** (Monday to Sunday), a **Month** or a **Custom range** of up to a year, with arrows to step back and forward: the total, a chart by day, and the totals by kind, by bot and, for owners and admins, by person. The kinds are **Premium AI**, **Economy AI**, **Pictures**, **Computer days** and **Commands**. Days and months are UTC's, the same for everyone. Day-by-day totals are kept 13 months, so for an older month choose **Month**: it shows the month's totals, without the chart. **Download CSV** saves the same period as a spreadsheet file, one line per day (per month, for those older months), bot, person and kind. Members see and download their own use.
- **How spending is counted:** what the figures are, as below.

Each bot shows what it cost this month beside its name in the sidebar (your own use of it, for members); hover over the figure for its all-time total. The account menu's first row, **Spending**, shows this month's figure; hover over it for whose figure it is and **See spending**, which opens this section.

### How spending is worked out

Each piece of work is counted once it's done, for the home, bot and person it was for:

- **An AI call** counts what the AI provider says it cost, or else what it used at that provider's list prices. A call that fails costs nothing. One cut off before it finishes, or that comes back without its own figures, is counted from its size, as an estimate.
- **A picture**, or a photo read for the Vault, counts what the call to the pictures AI cost.
- **A bot's computer** counts one day the first time it starts each day (UTC), however often it wakes that day. It costs nothing.
- **Commands** count the time they ran. They cost nothing.

What your AI accounts have left is on each provider's own website.

## Mercbot account and About

### Mercbot account

Linking a copy of Mercbot to your account on another Mercbot that connects accounts for it (its hub) lets the copy connect Google, Microsoft and GitHub without registering any apps of its own. Your mail, calendar and files still travel straight between the copy and those services.

- **Not linked:** type a **Name for this copy** and select **Link**. Approve the link in the tab that opens, signed in to your account on the hub, and check it shows the same code.
- **Linked:** shows the hub and the copy's name, with **Unlink**. The person who linked the copy can unlink it, and so can the owners and admins of a home they're in (or of any home, once that person's account is gone). **Unlink** asks first, because it signs out every account connected through the hub, in every home. The home's **Activity** records who unlinked it.

If no hub is set up for a copy (`MERCBOT_HUB_URL`), the section says so. See [Running your own copy of Mercbot](/help/own-copy).

### About

The version, with a button to copy it. Mercbot on your own computer is updated with `mercbot upgrade` there; any other copy is updated by whoever runs it.

## Account details

**Settings** > **General** > **Account details** opens your account page. It has:

- **Profile:** your picture (upload or **Remove avatar**) and **Display name**. Your email is shown but managed by your sign-in account. Your picture also shows on the account button at the bottom of the sidebar; without one, the button shows your initials.
- **Preferences**, **Bots** (the same **Auto-review** switch and rules as **Permissions**) and **Spending** (this month's figure).

Mercbot doesn't send product, activity or security emails yet, so there are no notification switches.

The bar at the top says **Account settings**. Its back arrow returns to where you were, and **Done** closes the page.

## Each bot's own settings

A bot's own options are in its **Details** panel. Select the bot's name in the chat header or press **Ctrl+Alt+B**.

- **Name and label:** edit them in place.
- **Who sees what:** private, mixed or shared, chosen by the home's owners and admins. See [Bots shared in a home](/help/shared-bots).
- **Notebook:** in a mixed bot, the home's notebook, and **Keep my chats with** the bot **out of it**.
- **Routines:** each with a switch; right-click for **Pause**, **Resume**, **Edit** and **Delete**.
- **Apps:** whether the bot is the home's Builder, and its watches.
- **Came from:** for a bot added from a template.
- The **Library** and **Computer** tabs.

Connected apps, their accounts and their tool switches are in **Connect apps**, in the sidebar.

## Signs that a bot needs you, and notifications

Mercbot shows news inside the app:

| Sign | Where | Meaning |
| --- | --- | --- |
| A dot on the bot's row or tile | Sidebar | Something new arrived since you last looked. |
| An amber dot and **Waiting for you:** with a task | Sidebar | The bot has handed you its screen and is waiting. |
| **Draft:** in the preview | Sidebar | You started a message to this bot and didn't send it. |
| The bot's face changing | Sidebar and chat | The bot is working, for example on a routine. |
| A status line | Chat | What the bot is doing right now. |
| A "new" divider | Chat | Where the messages you haven't seen start. |
| A card with buttons | Chat | The bot is waiting for an answer: an approval, a draft to send, a sign-in form or a question. |
| A dot on the menu button | Phone | Another bot has something new. |
| **Needs auth** or **Needs more access** | Connect apps | An account needs signing in. |

Right-click a bot and choose **Mark as unread** to keep it in view for later.

Mercbot doesn't send phone or browser notifications, or emails, when a bot replies or a routine runs. Results wait in the bot's chat, marked unread.

## How errors appear

- **Something you did didn't work:** a short message appears briefly, such as "Your message didn't send." or "That didn't work. Try again."
- **In a form:** the problem shows beside it, such as a vault item or a storage address that couldn't be saved.
- **A bot's job went wrong:** the bot says so in the chat. A reply that fails or runs out of time ends with the bot's own account of what it did and what's left. A routine that couldn't finish says it'll try again at the next scheduled time.
- **A dropped connection:** Mercbot retries sending and waiting for replies by itself, so a brief drop usually goes unnoticed.
- **The screen:** if a bot's computer can't be shown, the live view says **Couldn't reach the screen**, with **Try again**.
- **Mercbot doesn't start:** the page explains, with a **Reload** link.

For fixes, see [Fixing common problems](/help/troubleshooting).

## Questions

### My language or time zone changed on another device. Why?

Language and time zone are kept per device. Set them in **Settings** > **General** on each device you use.

### Who can change where the home's files are kept?

The home's owners and admins. Members see the current storage choice.

### Does Reset delete my files or vault?

No. It clears the bots' browsers only: open pages, sign-ins and website data.

## Related pages

- [Approvals, safety and privacy](/help/approvals-and-privacy)
- [The vault: saved logins and secrets](/help/vault)
- [The bots' computer and connected apps](/help/computer-and-apps)
- [Homes: Mercbot for families and teams](/help/homes)
- [Bots: create, shape, organise and remember](/help/bots)
- [Fixing common problems](/help/troubleshooting)
