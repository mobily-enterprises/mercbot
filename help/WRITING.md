# Writing Mercbot's help centre

Brief for the writers of `help/*.md`. The page set, order and target lengths are in `help/index.json`.

## Write about Mercbot, from Mercbot's own sources
- Every page describes **Mercbot's own** features, names and limits, as they exist now.
- Learn them from this repository only:
  - `genesis/blueprint.md` and `genesis/program/**`: Mercbot's own explanation of every feature
  - `docs/decisions.md`: the design decisions
  - `docs/architecture.md`
  - the code in `packages/` and `src/` when you need to confirm a detail
- **Mercbot only:** never describe another product, and don't learn Mercbot from the web. If a page's
  plan asks for something Mercbot doesn't have, leave it out or reshape the page around what Mercbot does.
- Never invent a feature, price, limit, setting name or button. If you can't confirm something in
  the repository, leave it out.
- The bots' own email addresses and outside chat services (Slack, WhatsApp, Telegram) are not
  available yet. Don't describe them as working; at most, say a feature is "on its way" if
  docs/decisions.md says it's planned. Voice conversations are built: in a chat with one bot, using the
  browser's own speech recognition and speech.

## Format (Markdown)
- The first line is `# <the page title from help/index.json>`.
- Then a one-paragraph introduction.
- Then `## ` sections, 5–12 of them (they make the page's "on this page" outline), with `### ` inside
  where useful. Use numbered steps when the reader follows an order, bullet lists for options, and
  tables for limits and states.
- Most pages end with `## Questions` (each question a `### ` heading with a short answer), then
  `## Related pages`, a bullet list of links like `[Bots](/help/bots)` using slugs from `help/index.json`.
- Name things the way the app does (Connect apps, the Details panel, Settings, the vault, Apps, the
  Builder, homes). Bold a button or menu item the first time it's mentioned.
- Plain, friendly, British English. Short sentences. No marketing language. Don't mention other
  products, decisions (D-numbers) or code.
- Aim for the target word count in `help/index.json`; shorter is fine when Mercbot has less to say,
  never pad.

## Check
The help centre (`src/components/help/HelpCentre.vue`) shows every page listed in `help/index.json`
that has a file. Check each page starts with its exact `# ` title:
`node -e 'const i=require("./help/index.json"),fs=require("fs");for(const g of i.groups)for(const p of g.pages){const f="help/"+p.slug+".md";if(!fs.existsSync(f))console.log("missing",p.slug);else if(fs.readFileSync(f,"utf8").split("\n")[0]!=="# "+p.title)console.log("title?",p.slug)}'`
