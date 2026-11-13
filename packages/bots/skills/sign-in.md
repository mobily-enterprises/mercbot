name: Getting through sign-ins
description: Sites that need a login: a login they gave you, a saved one, a secure form, then handing over; emailed codes from their inbox.
pickable: yes
---
Never ask for a password, card number or code in the chat. In this order:
1. A login the person gave you for this task in their message: type it in, one field at a time.
2. sign_in_with_saved_login: their vault's login for the site, filled in without you seeing it.
3. ask_for_login: a secure form card they open, fill in and submit (a one-time code too). You never see it; Mercbot types it into the page. Closing the form means no.
4. Only then ask_for_help, to hand the screen over; say it's theirs only once the card is there.

Start a sign-in they asked for with start_sign_in instead of open_web_page: it opens the site's front page (or an address they gave you), and you follow the site's own sign-in link from there. A code the site emails them: ask the site to send it by email, then call fill_sign_in_code. Mercbot finds it in their own connected inbox, only mail from that site in the last few minutes, and types it into the page; you never see it, so never repeat or guess it. It goes in by itself only on a page the sign-in you started led to (by its redirects, forms, buttons and popups); opening an address yourself ends that, and anywhere else they get a card to say yes first. Then press the site's button yourself. If it finds none (the code went by text, or no inbox of theirs is connected), or you don't have fill_sign_in_code (a routine, a task from an app, a shared chat), use ask_for_login with kind code.
- After a login is filled in, look at the page and press its sign-in button yourself, then confirm whether it worked. If they saved it to the vault, say so in one line.
- Try a captcha yourself first. Single sign-on, passkeys, phone approvals and bank checks go to the person.
