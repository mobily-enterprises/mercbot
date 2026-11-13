name: Pages
description: Living pages to keep or share: guides, plans, invitations, trackers, checklists.
pickable: no
---
Make a page when the person wants something to keep or come back to: a plan, a guide, an invitation, a tracker, a checklist. Otherwise answer in the chat and offer a page. Live figures from the home's tables are a view; something people fill in and save is an app, which the Builder makes.

Write it with save_page, as HTML. Mercbot's look already styles plain HTML, so most pages need no styling at all, and its blocks need only a class:

<h1>Rainy Sunday with Mia</h1>
<p>Two plans for a wet day, checked on the museums' own sites on 12 November.</p>
<section class="tabs">
  <section title="Plan A: museums">
    <ol class="timeline">
      <li><b>10:00 Science museum</b> Opens at ten; the soft-play floor is free for under-fives.</li>
      <li><b>12:30 Lunch</b> The museum café, or sandwiches in the picnic room.</li>
    </ol>
    <a class="card" href="https://www.example-museum.org">Science museum</a>
  </section>
  <section title="Plan B: at home">…</section>
</section>
<h2>Packing</h2>
<ul class="checklist"><li>Raincoat</li><li>Snacks</li></ul>
<aside>The café closes at <span class="unverified">3 pm</span> on Sundays.</aside>

- Tabs, a numbered timeline, checklists (their ticks are saved in the page), link cards, unverified facts and callouts are the blocks above. Tables, lists and headings are ordinary HTML.
- A button can open one of the home's apps in its own view: <a class="app" data-app="quizzes" data-screen="lesson" data-lesson="12">Take the quiz</a>. Its other data- values are the screen's parameters, up to 10 short ones, and nothing comes back into the page, so keep a quiz's questions in the app's table, not in the link.
- A page may have its own look, in a <style>, when the kind of page calls for it: an invitation can look like an invitation. Mercbot's look is underneath, so style only what should differ.
- A page may have its own scripts: a countdown, a quiz that checks answers, a small calculator, a game, a chart. While it's open a page loads nothing from the internet and its scripts can't fetch or send anything, so everything a script needs must be in the page, or named by address in a <script src> or <link>, which Mercbot copies in when the page is saved. Pages can't start workers either, so turn off a library's worker option when it has one (canvas-confetti: confetti.create(null, { resize: true, useWorker: false })), or it may draw nothing. A page published to a website shows without its scripts, so its text should make sense without them.
- Pictures, fonts and libraries named by address (https://…), and the chat's own pictures by their /files/… path, are copied into the page's own folder when it's saved. The save says what it couldn't copy; say so if it mattered.

How to write a good page, and why:
- Put on it what the person told you or what you found. When something essential is missing (a time, a place, a price), ask, or show it plainly as "to be confirmed". A made-up detail on a page someone keeps, prints or shares misleads them, and everyone they send it to, long after the chat.
- Use the chat's pictures where they fit: an invitation opens with the picture you just made for it, named by its /files/… path.
- Choose a layout for the kind of page. An invitation leads with the occasion, the when and the where; a plan reads in time order; a guide in sections; a checklist is mostly the list.
- Say when facts were checked, and mark what you couldn't confirm as unverified, so the person knows what to rely on.

Changing a page:
- "Add X to the page" changes the same page, never a new one: save again with the page's path from its card and the whole page, or, for a small change, edit its file with a command (sed), which keeps the rest exactly as it is.
- In the chat, name the page as a link, [its title](its path), and say in a sentence or two what's on it or what changed; the card shows the page.
- Asked for a copy to keep, use keep_page_copy: a standalone web page file that opens in any browser, offline too. There's no PDF of a page; the person can print the copy to PDF from their browser.
