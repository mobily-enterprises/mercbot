import { describe, expect, it } from "vitest";
import { guessKind, importItems, itemsFrom, matchColumns, previewValue, readCsvFile } from "../../src/components/mercbot/vaultImport.js";

// The Vault's Import from a CSV file: files from password managers, browsers and address
// books are matched by their column names, previewed with secrets hidden, and sent in batches.
const csv = (name, text) => new File([text], name, { type: "text/csv" });

describe("Import from a CSV file", () => {
  it("reads a browser's password export and matches its columns", async () => {
    const [header, ...rows] = await readCsvFile(csv("Chrome Passwords.csv", "﻿name,url,username,password,note\nExample,https://www.example.com/login,me@example.com, two spaces ,\n\nBank,https://bank.example/,me,\"pw,with,commas\",Joint account\n"));
    expect(header).toEqual(["name", "url", "username", "password", "note"]);
    expect(guessKind(header)).toBe("login");
    const columns = matchColumns("login", header);
    expect(columns).toEqual({ website: 1, username: 2, password: 3, notes: 4 });
    expect(itemsFrom("login", rows, columns)).toEqual({
      items: [
        { row: 2, data: { website: "example.com", username: "me@example.com", password: " two spaces " } },
        { row: 3, data: { website: "bank.example", username: "me", password: "pw,with,commas", notes: "Joint account" } }
      ],
      skipped: []
    });
  });

  it("refuses a file that isn't a .csv, one too large to read, and one that isn't valid CSV", async () => {
    await expect(readCsvFile(csv("passwords.txt", "a,b\n1,2\n"))).rejects.toThrow("Choose a .csv file.");
    await expect(readCsvFile(new File([new Uint8Array(10 * 1024 * 1024 + 1)], "huge.csv"))).rejects.toThrow(
      "That file is larger than 10 MB. Split it into smaller files."
    );
    await expect(readCsvFile(csv("broken.csv", 'name,url\n"Broken,https://x.example\nOther,https://y.example\n'))).rejects.toThrow(
      "That file isn't valid CSV around line 3. Export it again, or open it in a spreadsheet and save it as CSV."
    );
  });

  it("knows cards and contacts by their columns, and a column fills one field at most", () => {
    expect(guessKind(["Card Number", "Expiry", "CVV"])).toBe("card");
    expect(guessKind(["Name", "E-mail Address", "Mobile Phone"])).toBe("contact");
    expect(matchColumns("card", ["Name on card", "Card Number", "Exp Date", "CVV", "Billing Address"])).toEqual({
      number: 1,
      expiry: 2,
      code: 3,
      name: 0,
      nickname: -1,
      billing: 4
    });
    // A login file's "name" is the site's when there's no URL column, but never both website and username.
    expect(matchColumns("login", ["Title", "Login", "Password"])).toEqual({ website: 0, username: 1, password: 2, notes: -1 });
    expect(matchColumns("contact", ["Name", "E-mail Address", "Mobile Phone", "Zip"])).toMatchObject({ fullName: 0, email: 1, phone: 2, postalCode: 3, label: -1 });
  });

  it("previews what will be saved and which rows can't be, by the server's own rules", () => {
    const columns = { number: 0, expiry: 1, code: 2, name: 3, nickname: -1, billing: -1 };
    const rows = [
      ["4242 4242 4242 4242", "7/2028", "123", " A Person "],
      ["4242 4242 4242 4241", "07/28", "", ""],
      ["5555555555554444", "2029-11", "", ""],
      ["", "", "", ""]
    ];
    expect(itemsFrom("card", rows, columns)).toEqual({
      items: [
        { row: 2, data: { number: "4242 4242 4242 4242", expiry: "07/28", code: "123", name: "A Person" } },
        { row: 4, data: { number: "5555555555554444", expiry: "11/29" } }
      ],
      skipped: [{ row: 3, problem: "That card number isn't valid." }]
    });
    expect(itemsFrom("login", [["example.com", "me", ""]], { website: 0, username: 1, password: 2, notes: -1 }).skipped).toEqual([
      { row: 2, problem: "A login needs a website and a password." }
    ]);
    // After an import that stopped part way, the rows it added are left out of the next one.
    expect(itemsFrom("card", rows, columns, new Set([2])).items.map((item) => item.row)).toEqual([4]);
    expect(previewValue("number", "4242 4242 4242 4242")).toBe("•••• 4242");
    for (const field of ["password", "notes", "code", "billing"]) expect(previewValue(field, "secret")).toBe("••••••");
    expect(previewValue("website", "example.com")).toBe("example.com");
    expect(previewValue("password", "")).toBe("");
  });

  it("sends 100 items at a time, and stops at a refused batch with the number added before it", async () => {
    const items = Array.from({ length: 250 }, (_, index) => ({ row: index + 2, data: { fullName: `Person ${index}` } }));
    const batches = [];
    expect(await importItems("contact", items, async (kind, batch) => batches.push([kind, batch.length]))).toEqual({ added: 250 });
    expect(batches).toEqual([["contact", 100], ["contact", 100], ["contact", 50]]);

    const refusal = new Error("Row 150: Add at least a name, an address, an email or a phone number.");
    let calls = 0;
    const stopped = await importItems("contact", items, async () => {
      calls += 1;
      if (calls === 2) throw refusal;
    });
    expect(stopped).toEqual({ added: 100, error: refusal });
    expect(calls).toBe(2);
  });
});
