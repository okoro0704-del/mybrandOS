/**
 * Bounded Living Conversation keyboard — immersive comment composer only.
 * V1 is basic Latin/English. System keyboard remains the IME / a11y fallback.
 */

export const COMMENT_DRAFT_MAX = 2000;

export type CommentKeyboardState = "CLOSED" | "LETTERS_LOWER" | "LETTERS_SHIFT" | "SYMBOLS";

export type CommentKeyboardEvent = "OPEN" | "CLOSE" | "SHIFT" | "SYMBOLS" | "ABC" | "LETTER";

export const COMMENT_LETTER_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["z", "x", "c", "v", "b", "n", "m"],
] as const;

export const COMMENT_SYMBOL_ROWS = [
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
  [".", ",", "?", "!", "'", '"', "-", "@", "#"],
  ["(", ")", "&", ":", ";", "/", "_", "+"],
] as const;

export function isCommentKeyboardOpen(state: CommentKeyboardState): boolean {
  return state !== "CLOSED";
}

export function reduceCommentKeyboard(
  state: CommentKeyboardState,
  event: CommentKeyboardEvent,
): CommentKeyboardState {
  switch (event) {
    case "OPEN":
      return state === "CLOSED" ? "LETTERS_LOWER" : state;
    case "CLOSE":
      return "CLOSED";
    case "SHIFT":
      if (state === "LETTERS_LOWER") return "LETTERS_SHIFT";
      if (state === "LETTERS_SHIFT") return "LETTERS_LOWER";
      return state;
    case "SYMBOLS":
      return state === "CLOSED" ? state : "SYMBOLS";
    case "ABC":
      return state === "CLOSED" ? state : "LETTERS_LOWER";
    case "LETTER":
      return state === "LETTERS_SHIFT" ? "LETTERS_LOWER" : state;
    default:
      return state;
  }
}

export function segmentGraphemes(value: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)).map(
      (part) => part.segment,
    );
  }
  return Array.from(value);
}

export function applyCommentInsert(draft: string, text: string, max = COMMENT_DRAFT_MAX): string {
  if (!text) return draft;
  const room = max - draft.length;
  if (room <= 0) return draft;
  return draft + text.slice(0, room);
}

export function deleteCommentGrapheme(draft: string): string {
  const parts = segmentGraphemes(draft);
  if (!parts.length) return "";
  parts.pop();
  return parts.join("");
}

export function letterForKeyboard(raw: string, state: CommentKeyboardState): string {
  if (state === "LETTERS_SHIFT") return raw.toUpperCase();
  return raw;
}

export function canSendComment(draft: string): boolean {
  return draft.trim().length > 0;
}

export function physicalKeyToCommentAction(
  key: string,
  state: CommentKeyboardState,
): { insert?: string; backspace?: boolean; send?: boolean; space?: boolean } | null {
  if (state === "CLOSED") return null;
  if (key === "Backspace") return { backspace: true };
  if (key === "Enter") return { send: true };
  if (key === " ") return { space: true };
  if (key.length === 1 && key >= " " && key <= "~") {
    if (state === "LETTERS_SHIFT" && /[a-z]/i.test(key)) return { insert: key.toUpperCase() };
    return { insert: key };
  }
  return null;
}
