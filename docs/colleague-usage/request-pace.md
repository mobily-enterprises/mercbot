# Choose how fast Mercbot uses an app (Request pace)

Every app Mercbot uses for people (Gmail, Google Calendar, Google Contacts, Google Drive, Outlook, OneDrive, GitHub,
Notion, Todoist, Calendly and Sedna) limits how many requests it takes. Mercbot keeps each connected account's requests
to a share of that limit, its **Request pace**, from every bot, routine and server together, and waits whenever the app
asks it to. This guide covers choosing the pace, what each one means for each app, and what "busy" means.

## Choose the pace

1. Open **Connect apps** (Ctrl+Shift+M, or search for it) and open the app.
2. Under **Request pace**, each connected account has three choices: **Gentle**, **Normal** and **Fast**. Select one;
   it applies at once, to every bot and routine using that account.

Every account is **Gentle** until someone chooses another, including every account connected before the setting
existed. Who may change the account chooses its pace: the person who added it, and the home's owners and admins (every
account is the home's). Everyone else sees the pace but can't change it.

- **Gentle** (the default) uses a tenth of what the app allows. Choose it when the app's account is also used by other
  programs, such as a Sedna organisation's other integrations, or when in doubt.
- **Normal** uses four tenths.
- **Fast** uses nine tenths: close to the app's limit, never over it. Choose it only when Mercbot is the account's main
  user and bots need to read a lot quickly.

Half of a pace's share may go at once (a search and the messages it found); the rest is spread evenly, so Mercbot never
sends more than its share in any stretch of the app's own window.

## What each pace means for each app

What each app publishes as its limit for one account, and what each pace sends at most:

| App | The app's limit | Gentle | Normal | Fast |
| --- | --- | --- | --- | --- |
| Sedna | 100 a second, per credential or address | 10 a second | 40 a second | 90 a second |
| Gmail | 300 reads a minute (6,000 quota units) | 30 a minute | 120 a minute | 270 a minute |
| Google Calendar | 600 a minute | 60 a minute | 240 a minute | 540 a minute |
| Google Contacts | none published; one a second is assumed | 6 a minute | 24 a minute | 54 a minute |
| Google Drive | about 3,000 a minute (325,000 quota units) | 300 a minute | 1,200 a minute | 2,700 a minute |
| Outlook | 10,000 in 10 minutes | 1,000 in 10 minutes | 4,000 in 10 minutes | 9,000 in 10 minutes |
| OneDrive | 3,000 in 5 minutes | 300 in 5 minutes | 1,200 in 5 minutes | 2,700 in 5 minutes |
| GitHub | 5,000 an hour, shared with the person's other GitHub apps | 500 an hour | 2,000 an hour | 4,500 an hour |
| Notion | 180 a minute | 18 a minute | 72 a minute | 162 a minute |
| Todoist | 1,000 in 15 minutes | 100 in 15 minutes | 400 in 15 minutes | 900 in 15 minutes |
| Calendly | 50 a minute (free plan) | 5 a minute | 20 a minute | 45 a minute |

A single bot action usually takes one to a few requests: reading a Sedna message takes three to six, listing recent
Sedna mail up to fifteen or so, a Gmail search one plus one per message found. At Gentle, Calendly and Google Contacts
allow only a couple of actions a minute; choose Normal for them if bots use them often.

## When an app is busy

A bot, or a card, says **"*App* is busy: try again in *N* s. Nothing was done."** when:

- the app asked Mercbot to wait (it answered "too many requests"), for longer than a few seconds: Mercbot sends that
  account nothing more until the wait is over, from any bot or server; or
- the account's pace has no turn free in the next 20 seconds, because its bots and routines already used it.

Nothing was sent or changed. Wait the time it names, then ask again. A wait of a few seconds is waited out once,
without saying anything. If it happens often, a faster pace helps unless the app itself is asking to wait (then the
app's own limit is reached, often by other programs using the same account: choose a slower pace instead). A routine
that meets a busy app reads the same new mail again on its next run, so nothing is skipped.

## What Colleague can do

Colleague can explain the paces and the busy message and open Connect apps on the app. The person selects the pace
themselves.
