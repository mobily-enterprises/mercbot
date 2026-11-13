# Publish a page to your own website

A home's owners and admins can put a page a bot wrote on a website they already have: a folder on Mercbot's computer
that a web server serves, or S3-compatible storage. The page goes up on its own, with its look and pictures, without
its scripts, at its own address. This guide covers setting the website up, publishing, and what each refusal means.

## Set the website up (once per home)

1. Open **Settings** → **Website** (the address `?settings=website` opens it).
2. Choose where pages go:
   - **A folder on this computer:** enter its whole **Folder** path, a folder the web server already serves and that
     Mercbot's own user may write in. Only whoever runs the copy is offered it: in Mercbot, its one person.
     A copy built on Mercbot may name the people who run it (`mercbot.copy-runners`). A copy with several people and
     no such list has nobody who runs it, so nobody there can choose a folder, and its websites use S3-compatible
     storage. Anyone else gets "Only the people who run this copy of Mercbot can publish to a folder on its computer."
   - **S3-compatible storage:** **Endpoint** (empty for Amazon S3), **Bucket**, **Region**, optionally **Folder in the
     bucket**, and an **Access key** with its **Secret** that may list, read, write and delete in the bucket.
3. Enter **Its address on the web**: where that folder or bucket folder is served, such as
   `https://example.com/pages/`.
4. Select **Save**. Mercbot checks the folder or bucket first and saves only if it can use it.

The access key and secret are a human step: the person types them into Settings themselves. Never ask for them, paste
them in a chat or put them in a file. They're sealed with the vault key and never shown again; leaving the fields
empty keeps the saved ones.

## Publish, publish again, unpublish

1. Open the page (its card in the chat, or the Library) and select **Share**.
2. Beside **Your website**, select **Publish**. The first publish to a new website, place or address asks
   "Publish to your website?" and needs **Publish** again: the page will be on the internet for anyone.
3. The page's address appears (`<address>/<page name>/`) with **Copy** and **Open**.
4. **Publish again** replaces the copy after the page changes; **Unpublish** takes it off. A page moved keeps its
   address; a page deleted is taken off the website.

Members see whether a page is published and can unpublish it, but only owners and admins set the website up or
publish.

## When something goes wrong

- **"The page was uploaded, but …"**: the upload worked, but the address didn't answer with the page. The address in
  Settings → Website usually doesn't match where the web server serves the folder, or the server isn't serving it.
- **"The folder … isn't there"** or **"Mercbot may not write in …"**: fix the folder or its permissions on the
  computer, then save again.
- **"… didn't accept these keys"**, **"There's no bucket …"**, **"… isn't in the region …"** or **"These keys may not
  change the bucket …"**: correct the storage's settings in Settings → Website.
- **"Something Mercbot didn't put there is at … already"**: the page's address holds a folder Mercbot didn't make.
  Move it away on the website, or rename the page.
- **"Pages are published on this website"**: the place can't change, and the website can't be removed, while pages
  are on it. Unpublish them first.
- **"This server can't keep a website's keys safe"**: the copy has no `MERCBOT_VAULT_KEY`.
- **"… is on a private network. Only the people who run this copy of Mercbot can …"**: someone who doesn't run the
  copy entered storage or a website address on a private network (`localhost`, `10.…`, `192.168.…`, a cloud's metadata
  address, or a name leading to one). Enter storage and an address on the internet, or have someone who runs the copy
  set the website up. After an upload, **"… leads to a private network address …"** says the
  same of the read-back (the address, or a redirect from it, leads there).

## Trying it in a Preview

A folder website works on the Preview's own machine: make an empty folder, serve it with any static web server, enter
the folder and the server's address in Settings → Website, and publish a page. Never use a real cloud account to try
the S3 kind; the tests use a stand-in (`tests/support/fakeS3.mjs`).

Colleague can explain each step and offer to open Settings → Website or a page's Share; setting the keys, confirming
the first publish and publishing itself stay with the person.
