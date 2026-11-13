inbox.txt has messy text with email addresses and Australian phone numbers. Write contacts.json with two lists:
- "emails": every distinct email address, lowercased, sorted;
- "phones": every distinct phone number normalised to international form without spaces (for example +61412345678; a landline like (08) 9300 4321 becomes +61893004321), sorted.
Don't include things that only look like numbers (versions, prices).
