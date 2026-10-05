export function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after = before,
): { next: string; start: number; end: number } {
  const selected = value.slice(start, end) || "text";
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  return {
    next,
    start: start + before.length,
    end: start + before.length + selected.length,
  };
}

export function applyMark(value: string, start: number, end: number, mark: string) {
  switch (mark) {
    case "bold":
      return wrapSelection(value, start, end, "**");
    case "italic":
      return wrapSelection(value, start, end, "*");
    case "underline":
      return wrapSelection(value, start, end, "__");
    case "h1":
      return wrapSelection(value, start, end, "# ", "");
    case "h2":
      return wrapSelection(value, start, end, "## ", "");
    case "quote":
      return wrapSelection(value, start, end, "> ", "");
    case "ul":
      return wrapSelection(value, start, end, "- ", "");
    case "link":
      return wrapSelection(value, start, end, "[", "](https://)");
    default:
      return { next: value, start, end };
  }
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const HTML_UNESCAPES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Encodes text for both element content and quoted attribute values. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * The link target is captured from already-escaped text (and may contain markup inserted
 * by earlier passes), so re-parse it and emit only an http(s) URL, freshly encoded.
 */
function safeHref(escapedUrl: string): string | null {
  const raw = escapedUrl.replace(/<\/?(?:strong|u|em)>/g, "").replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => HTML_UNESCAPES[e]);
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return escapeHtml(url.href);
  } catch {
    return null;
  }
}

/**
 * Book text is plain text with a small markdown subset; it is never trusted HTML.
 * Everything is escaped before any markup is introduced, so the only HTML in the
 * output is the fixed tags below plus a validated `href`.
 */
export function renderBookText(text: string): string {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, (match, label: string, url: string) => {
      const href = safeHref(url);
      return href ? `<a href="${href}" rel="noreferrer">${label}</a>` : match;
    })
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
    .replace(/\n/g, "<br />");
}
