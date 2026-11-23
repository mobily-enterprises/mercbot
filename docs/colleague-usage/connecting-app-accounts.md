# Connect an app account for the home, or remove it

Every account connected in **Connect apps** belongs to the home it was connected in: everyone in the home, and every
bot there, can use it, in any chat. Every app people sign in to (Gmail, Google Calendar, Google Contacts, Google Drive,
Outlook, OneDrive, GitHub, Notion, Todoist and Calendly) adds, signs in and removes its accounts the same way, in
Connect apps and from a bot's connect card. Only one button signs in, and it says so: **Sign in with Google** (or
Microsoft, GitHub, or the app's name). Sedna connects with API credentials instead: see
[Connect Sedna](connecting-sedna.md).

## Add an account

1. Open **Connect apps** (Ctrl+Shift+M, or search for it). Select **Add** beside the app, or open the app and select
   **Add to this home**. The app is added to the home and the **Add account** step opens. For an app already added,
   select **+ Add account** on its page.
2. **Label (optional)**, such as "Work". Without one, the account shows its address once signed in.
3. The step says who will use it: "Everyone in *home*, and their bots, can read and send from the account you
   connect." (for Gmail and Outlook; "… can use the account you connect." for other apps). Anyone in the home may add
   one. A person who wants to keep an account to themselves connects it in a home only they are in.
4. Select **Sign in with Google** (or the app's own). On a computer a small window opens on the app's sign-in page,
   with an account chooser; on a phone the sign-in takes the page. Pick the account, sign in and allow.
5. The window closes by itself and the account's line shows **Connected**, with a note "*App* is connected as
   *address*." On a phone the page comes back to Connect apps on the app.

A bot's connect card works the same way: its **Connect** says what connecting means, then shows the same Add account
step. Once signed in, the bot finishes the job it was waiting to do.

## The page a sign-in ends on

- **Connected to Google** (or the app): it closes by itself once Mercbot has the result. If it stays open (Mercbot was
  closed meanwhile), **Close** closes it. If the browser won't let the page close its window, it says **You can close
  this tab now**. The small **Back to Mercbot** opens Mercbot.
- **Couldn't connect**, and why: **Try again** starts the same sign-in again (where the browser keeps no record of it,
  **Close**).
- **Your organisation needs to approve Mercbot**: copy the approval link for the IT department, then sign in again
  once they've approved it.

## Who uses an account, and who changes it

- **Everyone in the home uses it.** Each line says so, such as "Everyone in *home*, and their bots, can read and send
  from pat@example.com.", then "Added by *name*." (or "Added by you."). Bots use it in every chat of the home, Public or
  Private, for whoever asked. Sedna works in any chat too, as the asking person's own Sedna user.
- **Sending.** A draft card shows which mailbox an email goes from, and is answered like any card: only by the person
  whose message started the work, in whatever chat it is.
- **Sign-in codes and links stay with whoever connected the mailbox.** Reading a mailbox someone else connected, a
  bot sees "[sign-in code hidden]" and "[sign-in link hidden]" in their place, and is told why. It's worked out from
  each email's wording, so a code that isn't for signing in (a discount code next to the word "code") may be hidden
  too; the person can open the email themselves. A bot typing an emailed code into a sign-in page uses only mailboxes
  the person connected.
- **Who changes it.** The person who added an account, and the home's owners and admins, rename it, sign it in again,
  choose its Request pace and remove it; they alone see its rename, sign-in and bin. Everyone else sees its status.
- **Someone who leaves takes their accounts.** When a person is no longer in the home, the accounts they added there
  are signed out and removed, and the **Activity** tab in **Apps** says "removed *app* *account*, which *name*
  connected, as they're no longer in the home". The apps they added stay on the home's list.

## Sign an account in again

A line that needs it shows **Needs sign-in** with **Sign in again** (or **Sign in**, **Reconnect** or **Retry**). The
sign-in suggests the account's own address. Signing in as another address changes nothing and says "This *app* account
is *address*, but you signed in as *other*, so nothing changed. To connect *other*, use + Add account." While the Add
account step is open, the lines' sign-in buttons are hidden.

## Remove an account, or the app

- **The bin** on any line, the first and the only one too, connected or not: after "Remove it for everyone in *home*?
  Their bots stop using it.", Mercbot withdraws the sign-in where the app allows (Calendly, Notion, Todoist), then
  deletes the account and its key. Removing an app's last account keeps the app in the home.
- **Remove from this home** on the app's page: after "Remove *app* from *home*, with its account? Everyone's bots stop
  using it." (or "with its 2 accounts"), it withdraws and removes every account of the app in the home, then the app.
  Owners and admins can always; the person who added the app can while every account of it is one they added. For
  anyone else the button isn't shown. The app can be added again any time.
- There's no Disconnect. To stop bots doing one thing with an app, switch that action off under the app's **Tools**
  (a person's own switch, for their own bots).

## GitHub: let bots push from their commands

Where the copy has its GitHub App (D-128), signing in to GitHub goes through it. It lets a bot's
commands clone the person's private repositories, push branches and open pull requests, with the person's yes on a card.

1. **Connect GitHub** as above. When Mercbot's GitHub App isn't installed on any of the person's GitHub accounts yet, the window
   says "Next, install Mercbot's GitHub App on GitHub and choose the repositories your bots may work on. Each bot still asks you
   before it uses one." with **Install on GitHub** beside **Close**. On GitHub they choose the account and its
   repositories (all, or only some). GitHub then shows **Mercbot's GitHub App is installed on GitHub** (or **The repositories Mercbot's GitHub App
   repositories are changed**), which they close.
2. **The account's line** in Connect apps then says where it's installed, "Mercbot's GitHub App is on ann, acme.", with **Choose
   repositories** (or "Mercbot's GitHub App isn't installed on GitHub yet." with **Install on GitHub**). Both open GitHub's own page
   for it.
3. **The card.** The first time a bot's command needs a repository, the bot posts **Let *bot* use *owner/name*?**, with
   whether its commands could push there or only read it, and **Just this task** (that bot in this chat, for 4 hours),
   **Always for this bot** (every chat, until removed) or **No**. **Choose another repository** searches the person's
   repositories as they type, 20 at a time with **More**; **Keep *owner/name*** goes back. Only the person whose
   message started the work answers it; anyone else sees "This is waiting for *name*'s OK."
4. **The bot carries on** once answered: each command on that repository gets its own key for that repository alone,
   lasting at most an hour and withdrawn when the command ends. It works on a branch and opens a pull request; it pushes
   to the default branch only when asked, and suggests a branch rule there.
5. **Taking it back:** a bot's card, **Details**, lists **GitHub repositories** the person allowed, each "Always" or
   "For one task, until *time*", with a remove button: "Remove *owner/name*?" and "*bot* will ask you again before its
   commands use it." Each person sees and removes only their own.

In a room a bot uses only the asking person's own GitHub account in the home and their own yeses, never another
person's, even though everyone's accounts are the home's for reading. A GitHub account connected before the GitHub App keeps
reading and managing issues and pull requests, and its line shows **Sign in again**: signing in again goes through
Mercbot's GitHub App and lets bots push.

## Messages

- **"Only the person who added this account and the home's owners and admins can change it."** Renaming, signing in
  again, the pace or the bin, by someone else: ask whoever added it (its line names them), or an owner or admin.
- **"Only the home's owners and admins can remove *app* from the home while it has accounts someone else added."**
  Ask an owner or admin, or remove one's own accounts with their bins.
- **"Only the home's owners and admins can connect *app*: its API credentials are the whole home's."** (Sedna.) Ask an
  owner or admin.
- **"Sign-in codes and links in this mailbox are hidden: someone else in the home connected it, and only their own bots
  see them. …"** What a bot is told; it says so rather than looking for the code another way. Ask the person who
  connected the mailbox.
- **"The Google Drive account this home's files are kept in was removed. An owner or admin can choose again in Settings
  → Files."** The person who connected it left or was removed, or someone removed the account.
- **"This sign-in was started in another browser, so nothing was connected. …"** Start again from Connect apps in the
  browser used to sign in.
- **"Mercbot's GitHub App doesn't reach *owner/name* with your GitHub."** Chosen on a GitHub card: it isn't one of their
  repositories, or the App isn't installed on it. Choose its repositories on GitHub (the account's **Choose
  repositories**), then choose again.
- **What a bot says when its command can't use GitHub:** "They haven't connected their own GitHub in this home." (connect
  GitHub in Connect apps), "Their GitHub was connected before bots could push: they sign in to GitHub again in Connect
  apps first.", or "*owner/name* isn't a repository Mercbot's GitHub App reaches with their GitHub…", with where to choose its
  repositories. "Commands can't sign in to GitHub here." means the copy has no GitHub app, or the work was asked for by
  another bot.

## What Colleague can do

Colleague can explain these steps and open Connect apps on the app. The person signs in and removes accounts or apps
themselves: each changes what everyone in the home and their bots can use. The same goes for GitHub: Colleague explains
the card and where a bot's repositories are listed, but the person answers the card, installs Mercbot's GitHub App and removes a
repository themselves.
