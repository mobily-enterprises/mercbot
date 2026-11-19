# Connect Sedna

Sedna is a shared email for shipping teams. A home's owners and admins connect it once, with API credentials that an
admin of the Sedna organisation makes, and then each person's bots read only that person's own Sedna teams. This guide
covers making the credentials, entering them, who each person is in Sedna, what bots can do, and what each refusal
means. For now bots only read: nothing in Sedna changes.

## Make the API credentials in Sedna (a human step)

1. An admin of the Sedna organisation opens Sedna, then **Settings**, then **API Credential Management** (its address
   is `https://<your Sedna address>.sednanetwork.com/platform/settings/api-credential-management`).
2. They make a credential there and note its client ID and secret. If Sedna lets them choose what it may do, reading is
   enough for now.
3. If that page isn't there, the organisation's Sedna plan may not include the API: ask Sedna's support.

The client secret is a human step: the person types it into Connect apps themselves. Never ask for it, paste it in a
chat or put it in a file.

## Enter them in Connect apps (owners and admins)

1. Open **Connect apps** (Ctrl+Alt+W, or search for it) and open **Sedna**, then select **Connect**. A form opens on
   the page; there is no sign-in tab.
2. Type the **Sedna address**: the first part of the address the organisation opens Sedna at (the *acme* of
   `acme.sednanetwork.com`; pasting the whole address works too). The form then links to that Sedna's API Credential
   Management page.
3. Type the **Client ID** and **Client secret** and select **Save**.

Mercbot checks them with Sedna first and saves nothing until Sedna accepts them. The account then shows the company's
name and **Connected**, for everyone in the home, and a note says how many of the home's people Sedna knows by their
email address. **Change credentials** enters new ones (checked the same way); **Disconnect** deletes them from Mercbot.
A member sees Sedna connected but can't connect, change or disconnect it.

## Who each person is in Sedna

The credentials could read every team's inbox, so a bot reads only what its person's own Sedna user sees.

- Mercbot finds each person by their sign-in email address: the one active Sedna user with it.
- Someone Sedna doesn't know by that address opens Sedna in Connect apps, finds themselves under **Who you are in
  Sedna** (name or email) and selects **This is me**. An owner or admin then selects **Confirm** beside them under
  **People** (or **Refuse**). An owner's or admin's own choice counts at once.
- Nobody can choose a Sedna user that someone else in the home already is, by address or confirmed. **That's not me**
  forgets one's own choice; owners and admins **Undo** anyone's.

Until a person is found or confirmed, their bots read nothing in Sedna, and say so.

## What bots can do with it

Only in a person's own chats with their bots, never in a shared conversation, and only their own Sedna teams' messages:

- the newest messages that came into their teams;
- messages with a tag, or linked to a job reference (a voyage, deal or order number);
- one message: sender, recipients, text, tags, job references, the team's comments and its attachments' names;
- lists of tags, job references, the person's teams and their teams' contacts.

Each of these is a switch under Sedna's **Tools** in Connect apps. Sedna has no search across message text, so bots
find messages by tag, by job reference or among the newest. Drafting, sending, tagging and assigning come later.

## When something goes wrong

- **"Sedna didn't accept that client ID and secret for X.sednanetwork.com."** The ID or secret is wrong, or the
  credential was deleted in Sedna. Check them on its API Credential Management page.
- **"No Sedna organisation answers at X.sednanetwork.com."** The Sedna address is wrong.
- **"Give your Sedna address's first part …"** Only letters, digits and dashes: the address can only ever be a
  `sednanetwork.com` one.
- **"Only the home's owners and admins can connect Sedna …"** A member asked; an owner or admin connects it.
- **"Sedna isn't connected: an owner or admin of the home enters its API credentials in Connect apps."** Sedna turned
  the saved credentials down (deleted or changed in Sedna), so Mercbot signed the account out: enter them again.
- **"… is someone else in this home at Sedna."** That Sedna user belongs to another person of the home. Pick yourself,
  or ask an owner or admin.
- **A bot says the person isn't matched to a Sedna user, or is waiting for confirmation:** pick yourself, or confirm
  them under **People**.
- **A bot says a message isn't in the person's teams:** it's another team's; the bot shows nothing of it.
- **A bot says Sedna is busy:** Sedna asked Mercbot to slow down. Try again after the wait it names.

## What Colleague can do

Colleague can explain these steps and open Connect apps on Sedna. It never enters, reads or asks for the client
secret: the person types it into the form themselves.
