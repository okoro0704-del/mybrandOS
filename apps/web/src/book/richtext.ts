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

export function renderBookText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<u>$1</u>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
    .replace(/\n/g, "<br />");
}
