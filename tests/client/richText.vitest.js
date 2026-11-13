import { describe, expect, it } from "vitest";
import { highlightCode, renderRichText } from "../../src/components/mercbot/richText.js";

describe("rich bot replies", () => {
  it("renders paragraphs, lists, emphasis and links with a site icon", () => {
    const html = renderRichText("Hi **there** and _Dune_.\n\n- one\n- two\n\nSee [docs](https://example.com/a).");
    expect(html).toContain("<strong>there</strong>");
    expect(html).toContain("<em>Dune</em>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain('class="mb-link"');
    expect(html).toContain('src="https://example.com/favicon.ico"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("never passes raw HTML through", () => {
    const html = renderRichText('<script>alert(1)</script><img src=x onerror="alert(1)">');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
  });

  it("shows links into connected apps as chips with the app's logo", () => {
    const html = renderRichText("See [octo/site](https://github.com/octo/site).");
    expect(html).toContain('class="mb-link mb-link--app"');
    expect(html).toContain('src="/api/plugins/github/logo.svg?tile=1"');
    expect(html).not.toContain("favicon.ico");
  });

  it("colours string values and keywords but not keys", () => {
    expect(highlightCode('{"a": true, "b": "x"}')).toBe(
      '{&quot;a&quot;: <span class="mb-code__keyword">true</span>, &quot;b&quot;: <span class="mb-code__string">&quot;x&quot;</span>}'
    );
  });
});
