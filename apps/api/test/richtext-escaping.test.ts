import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { escapeHtml, renderBookText } from "../../web/src/book/richtext.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const ALLOWED_TAGS = new Set(["strong", "u", "em", "a", "h1", "h2", "h3", "blockquote", "li", "ul", "br"]);

/**
 * Every tag in the output must be one the renderer emits, and the only attributes allowed
 * are an http(s) `href` and `rel="noreferrer"` on links. No raw quote may escape an attribute.
 */
function assertOnlyRendererMarkup(html: string) {
  for (const match of html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
    const [, tag, attrs] = match;
    assert.ok(ALLOWED_TAGS.has(tag.toLowerCase()), `unexpected tag <${tag}> in ${html}`);
    const rest = attrs.trim().replace(/^\/$/, "");
    if (tag === "a" && rest) {
      assert.match(rest, /^href="https?:\/\/[^"<>\s]*" rel="noreferrer"$/, `unexpected link attributes: ${rest}`);
    } else {
      assert.equal(rest, "", `unexpected attributes on <${tag}>: ${rest}`);
    }
  }
  // Outside renderer tags, user text must be fully encoded: no raw markup or quote survives.
  const text = html.replace(/<\/?([a-zA-Z0-9]+)([^>]*)>/g, "");
  assert.doesNotMatch(text, /[<>"']/, `unencoded markup character in ${html}`);
}

test("escapeHtml encodes every attribute-sensitive character", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("malicious link cannot break out of href with a double quote", () => {
  const html = renderBookText(`[x](https://a"onmouseover="alert(1))`);
  assertOnlyRendererMarkup(html);
  assert.doesNotMatch(html, /onmouseover="/);
});

test("malicious link cannot break out of href with a single quote or angle brackets", () => {
  for (const input of [
    `[x](https://a'onfocus='alert(1))`,
    `[x](https://a"><img src=x onerror=alert(1)>)`,
    `[x](https://a"><script>alert(1)</script>)`,
    `[x](https://a"/onclick="alert(1))`,
  ]) {
    assertOnlyRendererMarkup(renderBookText(input));
  }
});

test("label and body text cannot inject markup", () => {
  for (const input of [
    `[<img src=x onerror=alert(1)>](https://example.com)`,
    `<script>alert(1)</script>`,
    `**<svg onload=alert(1)>**`,
    `" onmouseover="alert(1)`,
    `# <iframe src="javascript:alert(1)"></iframe>`,
  ]) {
    assertOnlyRendererMarkup(renderBookText(input));
  }
});

test("only http(s) links become anchors", () => {
  for (const input of [`[x](javascript:alert(1))`, `[x](data:text/html,<script>alert(1)</script>)`, `[x](vbscript:msgbox)`]) {
    const html = renderBookText(input);
    assertOnlyRendererMarkup(html);
    assert.doesNotMatch(html, /<a /);
  }
});

test("markup inserted inside a URL by earlier passes cannot reach the href", () => {
  const html = renderBookText(`[x](https://example.com/a*b*c)`);
  assertOnlyRendererMarkup(html);
  assert.match(html, /<a href="https:\/\/example\.com\/abc" rel="noreferrer">x<\/a>/);
});

test("legitimate links and formatting still render", () => {
  assert.equal(
    renderBookText(`See [the docs](https://example.com/path?a=1&b=2#top) now`),
    `See <a href="https://example.com/path?a=1&amp;b=2#top" rel="noreferrer">the docs</a> now`,
  );
  assert.equal(renderBookText(`[**bold link**](http://example.com/)`), `<a href="http://example.com/" rel="noreferrer"><strong>bold link</strong></a>`);
  assert.equal(renderBookText(`**b** __u__ *i*`), `<strong>b</strong> <u>u</u> <em>i</em>`);
  assert.equal(renderBookText(`# Title\n- one\n- two`), `<h1>Title</h1><br /><ul><li>one</li><br /><li>two</li></ul>`);
  assert.equal(renderBookText(`It's "quoted" & <fine>`), `It&#39;s &quot;quoted&quot; &amp; &lt;fine&gt;`);
});

test("Book and Course previews both render rich text only through renderBookText", () => {
  for (const file of ["apps/web/src/book/BookPreview.tsx", "apps/web/src/course/CoursePreview.tsx"]) {
    const source = readFileSync(join(root, file), "utf8");
    const raw = [...source.matchAll(/dangerouslySetInnerHTML=\{\{ __html: ([^}]+) \}\}/g)].map((m) => m[1].trim());
    assert.ok(raw.length > 0, file);
    for (const expr of raw) assert.ok(expr === "html" || expr.startsWith("renderBookText("), `${file}: ${expr}`);
    if (raw.includes("html")) assert.match(source, /const html = renderBookText\(/);
  }
});
