# The vault: saved logins and secrets

The vault is your private store for website logins, payment cards and contact details. Its main job is to let bots sign in to websites for you without ever seeing your password: you save a login once, and when a bot reaches that site's sign-in page, Mercbot types it in for the bot. This page covers what the vault keeps, how to add items (one at a time, from a photo or from a CSV file) and change them, how bots use them, the secure form bots use when nothing is saved, and how payments work.

## What the vault keeps

Open **Settings** > **Vault**. Items come in three kinds, each with its own tab:

| Kind | What you save | What's sealed |
| --- | --- | --- |
| **Logins** | Website, username or email, password, notes | The password and notes |
| **Cards** | Card number, expiry, security code, name on card, nickname, billing address | The number, security code and billing address |
| **Contact info** | Label, full name, address, city, region, postal code, country, phone, email | Nothing: it's stored as ordinary details |

"Sealed" means encrypted before it's stored, with a key kept by the server. Only what you need to recognise an item stays readable: a login's website and username, or a card's type, last four digits and expiry.

Your vault is yours alone. Other people in your home can't see it, and their bots can't use it. Even your own bots don't use it in a shared bot's conversation tabs, where everyone can see what happens.

## Add an item

1. Open **Settings** > **Vault**.
2. Select **New item** at the top, then **Login**, **Card** or **Contact info**.
3. Fill in the form and select **Save**.

**Save** only works once the required details are there:

- **Login:** a website (such as example.com) and a password. Username and notes are optional.
- **Card:** a valid card number and an expiry written as MM/YY. The security code, name, nickname and billing address are optional. Select **+ Add a billing address** to add one.
- **Contact info:** at least a name, an address, an email or a phone number.

While you type a card's security code, the eye button shows or hides it.

The **Scan with camera** and **Upload a photo** buttons on the card form stay unavailable on purpose: reading a card from a photo would send its number to an AI, and a card's number never goes to one. Type the card in instead.

You can also save a login without opening Settings: when a bot shows you a secure form to sign in, leave **Save securely to your vault** ticked (see below).

## Fill in contact info from a photo

The contact info form can be filled in from a photo of a business card, a letter, an envelope or another document that shows the details.

1. Select **New item** > **Contact info**.
2. Select **Upload a photo** and choose a picture, or select **Scan with camera**, point the camera at the document and select **Take photo**. The camera is only on while its view shows; **Cancel** turns it off.
3. Mercbot fills in the details it could read and says **Filled in from the photo. Check each detail before saving.**
4. Check and correct each detail, add a label if you like, and select **Save**.

Google's Gemini reads the photo; it's sent once, as a smaller copy, and isn't kept by Mercbot. What reading it cost counts in the spending of the home you have open, like any AI call, and shows in **Settings** > **Spending**. Only contact details are read this way, never a login or a card. If a photo can't be read, the form says so and you can type the details in. If whoever runs your copy of Mercbot hasn't set up the picture service, the form says reading photos isn't set up and you type the details in.

## Import from a CSV file

You can add many items at once from a .csv file whose first row names its columns, such as the export of a password manager, a browser's saved passwords or an address book.

1. Select **New item** > **Import from a CSV file**.
2. Choose the file.
3. Check what the rows are: **Logins**, **Cards** or **Contact info**. Mercbot guesses from the column names (a password column means logins, a card number column means cards); select another if it guessed wrong.
4. Under **Which column fills each detail**, check the column chosen for each detail, or pick **Not used**. Common names, such as url, username, password, cvv or zip, are matched for you.
5. Check the preview: how many items will be added, the first five as they'll be saved, and each row that can't be saved, with why (for example, a login with no password). Passwords, notes, security codes and billing addresses show as dots, and card numbers by their last four digits.
6. Select **Import** and the number of items.

Good to know:

- The file is read in your browser. Only the details of the items you import are sent, and they're checked and sealed exactly like items you add by hand.
- A website address such as https://www.example.com/login is saved as example.com, and an expiry such as 7/2028 or 2028-07 as 07/28.
- A file can have up to 5,000 rows and be up to 10 MB. Items are saved 100 at a time; if a group can't be saved, the import stops there and says how many items were added. Select **Import** again to add the rest; the items already added aren't added twice.
- Importing the same file twice adds its items twice. Delete the copies you don't want.
- A password manager's export holds your passwords in plain text. Delete the file once the import is done.

## Find, change and delete items

- The tabs **All**, **Logins**, **Cards** and **Contact info** show how many items each has.
- The **Search** box finds items by their name and the details shown in the list.
- Each row shows what identifies the item: a login's username, a card's type, last four digits and expiry, or a contact's name and address.

Items can't be edited. To change one, for example after you change a password, add the new item and delete the old one.

To delete an item, select the bin button on its row and confirm. It's removed from your vault, and your bots can't use it any more.

## How bots sign in with a saved login

When a website needs a login, a bot tries these in order:

1. **A login you gave it for this task.** If your message includes a login for the site, such as a demo shop's published test login, the bot types it in.
2. **Your saved login for that site.** Mercbot finds the vault login whose website matches the page (a login for example.com also works on its sub-sites, such as shop.example.com) and types the username and password into the page itself. The bot learns that the login was filled in and which username was used, but never sees the password. It then presses the site's sign-in button and checks that it worked.
3. **A secure form.** If nothing is saved, the bot asks you through a secure form in the chat.
4. **Handing over the screen.** If that's not possible either, or the site wants something only you can do (a passkey, a phone approval, a bank check), the bot posts a **Your turn** card so you can sign in on its computer yourself. See [The bots' computer and connected apps](/help/computer-and-apps).

Bots never ask you to type a password, card number or code in the chat. If a bot ever reads one of your saved passwords on a page, Mercbot blanks it out of the bot's reply, so it never appears in the chat.

Once a bot has signed in, its browser usually stays signed in to that site, even after its computer sleeps. Resetting the computers in **Settings** > **Computer** signs every bot out of every website, but leaves your vault untouched.

## The secure form

When a bot needs a login it doesn't have, it opens the sign-in page on its computer and posts a secure form card in the chat. Open it and you'll see **Sign in to** the site's name (or **Code for** the site, when it needs a one-time code).

1. Type your **Username or email** and **Password**, or the **Code**. The eye button shows or hides the password as you type.
2. Leave **Save securely to your vault** ticked to keep the login for next time, or untick it to use it just this once.
3. Select **Submit**.

The form says it plainly: your bot never sees what you type, and it's only filled in on that site. Mercbot types the values straight into the sign-in page on the bot's computer. If the bot's browser has moved on in the meantime, Mercbot reopens the sign-in page first. A saved login appears in your vault under the site's name, and the bot mentions in a line that it's saved.

Select **Close** if you'd rather not sign in. The bot takes that as a no.

## Why you can't see saved values

The vault never shows a saved password, card number or security code again, not even to you. Once saved, these values are sealed. Mercbot only unseals a password on its own servers, to type it into a website for a bot and to keep it out of bots' replies. Nothing secret is ever sent back to your screen.

This means:

- If you've forgotten a password, the vault can't show it to you. Use the website's own password reset, then save the new login and delete the old one.
- Someone who opens your Settings on an unlocked device still can't read your secrets.
- A saved card's number and security code never reach a bot.

If whoever runs your copy of Mercbot hasn't set up the vault's key, the vault won't accept logins or cards, and you'll see that it isn't set up to keep passwords and cards on this server. Contact info can still be saved.

## Purchases and payments

Bots can shop for you: search, compare, fill a basket and get to the checkout. They stop before anything that commits you. Every bot follows the same rules:

- **A yes before paying.** A bot pays only at the final total, and only after you've said yes to the item, the shop and the total.
- **Card details at the checkout only.** Card details are only ever entered on the shop's own checkout page, never in the chat. For that step the bot hands you the screen, and you type them in yourself.
- **Budgets are limits.** A budget you give is a ceiling, not permission to spend it. The bot warns you before something would go over.
- **Price changes stop everything.** If the price changes after you said yes, the bot stops and asks again.

The same care applies to ordering, booking, sending, cancelling, posting and inviting. When a step on a website would buy, book, send, post, delete or save a change, the bot asks first with a card: **Go ahead** or **Don't do it**. Nothing happens until you choose. See [Approvals, safety and privacy](/help/approvals-and-privacy).

## Questions

### Can a bot read my saved passwords?

No. Mercbot types a saved password into the website itself. The bot only learns that a login was filled in, and with which username.

### Can other people in my home use my vault?

No. Each person's vault is private, and bots never use anyone's vault in a shared bot's conversation tabs.

### Do updates or a computer reset remove my vault items?

No. Updates and **Reset** only affect the bots' browsers. Your vault items stay until you delete them.

### I changed a password. What do I do?

Add a new login with the new password, then delete the old one. If a bot is already signed in to the site, it may stay signed in until the site asks again.

### Can I connect a password manager instead?

Bitwarden is listed in Connect apps, but it can't be connected yet. For now, export your password manager's logins as a CSV file and use **Import from a CSV file**, or save the logins you want bots to use one at a time.

### Why can't I scan a card?

Reading a card from a photo would send its number to an AI, and the vault never lets a card's number reach one. Type the card in; only you and the shop's checkout ever see its number.

### Is the photo of my business card kept?

No. It's sent once to Google's Gemini to read the details and isn't kept by Mercbot. What was read only fills the form; nothing is saved until you select **Save**.

### Why won't my card save?

Check the number is complete and correct, and that the expiry is written as MM/YY, such as 07/28. **Save** stays unavailable until both are valid.

## Related pages

- [The bots' computer and connected apps](/help/computer-and-apps)
- [Approvals, safety and privacy](/help/approvals-and-privacy)
- [Settings and notifications](/help/settings)
- [Security overview](/help/security)
- [Security questions and answers](/help/security-questions)
