import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  applyCommentInsert,
  canSendComment,
  COMMENT_DRAFT_MAX,
  COMMENT_LETTER_ROWS,
  COMMENT_SYMBOL_ROWS,
  deleteCommentGrapheme,
  isCommentKeyboardOpen,
  letterForKeyboard,
  physicalKeyToCommentAction,
  reduceCommentKeyboard,
  segmentGraphemes,
} from "../../web/src/lib/commentKeyboard.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const feed = readFileSync(join(root, "apps/web/src/experience/ImmersivePostFeed.tsx"), "utf8");
const keyboardUi = readFileSync(join(root, "apps/web/src/digital-life/personal-os/CommentKeyboard.tsx"), "utf8");
const styles = readFileSync(join(root, "apps/web/src/styles.css"), "utf8");
const player = readFileSync(join(root, "apps/web/src/media/AdaptiveVideoPlayer.tsx"), "utf8");

test("comment keyboard state machine is deterministic", () => {
  assert.equal(reduceCommentKeyboard("CLOSED", "OPEN"), "LETTERS_LOWER");
  assert.equal(reduceCommentKeyboard("LETTERS_LOWER", "SHIFT"), "LETTERS_SHIFT");
  assert.equal(reduceCommentKeyboard("LETTERS_SHIFT", "LETTER"), "LETTERS_LOWER");
  assert.equal(reduceCommentKeyboard("LETTERS_SHIFT", "SHIFT"), "LETTERS_LOWER");
  assert.equal(reduceCommentKeyboard("LETTERS_LOWER", "SYMBOLS"), "SYMBOLS");
  assert.equal(reduceCommentKeyboard("SYMBOLS", "ABC"), "LETTERS_LOWER");
  assert.equal(reduceCommentKeyboard("SYMBOLS", "CLOSE"), "CLOSED");
  assert.equal(reduceCommentKeyboard("CLOSED", "SYMBOLS"), "CLOSED");
  assert.equal(isCommentKeyboardOpen("CLOSED"), false);
  assert.equal(isCommentKeyboardOpen("LETTERS_LOWER"), true);
});

test("letters, shift, space, symbols, and send rules", () => {
  assert.deepEqual(COMMENT_LETTER_ROWS[0], ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"]);
  assert.equal(letterForKeyboard("a", "LETTERS_LOWER"), "a");
  assert.equal(letterForKeyboard("a", "LETTERS_SHIFT"), "A");
  assert.equal(applyCommentInsert("", "This video is beautiful!"), "This video is beautiful!");
  assert.equal(applyCommentInsert("hi", " "), "hi ");
  assert.equal(canSendComment("   "), false);
  assert.equal(canSendComment("ok"), true);
  assert.ok(COMMENT_SYMBOL_ROWS[0].join("").includes("1234567890"));
  assert.ok(COMMENT_SYMBOL_ROWS.flat().includes("?"));
  assert.ok(COMMENT_SYMBOL_ROWS.flat().includes("@"));
});

test("backspace is grapheme-safe and respects backend length", () => {
  assert.equal(deleteCommentGrapheme("hello"), "hell");
  assert.equal(deleteCommentGrapheme("hi👋"), "hi");
  const clustered = "e\u0301";
  assert.equal(segmentGraphemes(clustered).length, 1);
  assert.equal(deleteCommentGrapheme(`x${clustered}`), "x");
  const long = "a".repeat(COMMENT_DRAFT_MAX);
  assert.equal(applyCommentInsert(long, "z").length, COMMENT_DRAFT_MAX);
});

test("rapid 100-character inserts do not drop characters", () => {
  let draft = "";
  for (let i = 0; i < 100; i++) draft = applyCommentInsert(draft, "a");
  assert.equal(draft.length, 100);
  const physical = physicalKeyToCommentAction("Backspace", "LETTERS_LOWER");
  assert.deepEqual(physical, { backspace: true });
});

test("immersive composer uses internal keyboard and does not focus custom-mode textarea", () => {
  assert.match(feed, /<CommentKeyboard/);
  assert.match(feed, /data-comment-composer="internal"/);
  assert.match(feed, /PersistentGalleryVideo/);
  assert.match(feed, /memo\(function PersistentGalleryVideo/);
  assert.match(keyboardUi, /aria-label="Comment keyboard"/);
  assert.match(keyboardUi, /aria-label=\{label\}/);
  assert.match(keyboardUi, /label="Shift"/);
  assert.match(keyboardUi, /label="Backspace"/);
  assert.match(keyboardUi, /label="Space"/);
  assert.match(keyboardUi, /label="Numbers"/);
  assert.match(keyboardUi, /label=\{busy \? "Posting" : "Send"\}/);
  assert.match(feed, /className="living-gallery__send"/);
  assert.match(feed, /<Icons.send/);
  assert.match(feed, /comment-composer__type-in/);
  assert.match(feed, /System keyboard/);
  assert.match(styles, /\.comment-keyboard__key\s*\{[^}]*font-size:\s*1\.22rem/s);
  assert.match(feed, /inputMode === "system"/);
  assert.match(feed, /composerRef\.current\?\.focus/);
  assert.equal(feed.includes("contenteditable"), false);
  assert.equal(keyboardUi.includes("innerHTML"), false);
  assert.equal(feed.includes("autocorrect service"), false);
  assert.equal(feed.includes("predictive"), false);
  assert.match(styles, /\.comment-keyboard\s*\{[^}]*background:\s*transparent/s);
  assert.match(styles, /\.comment-keyboard__key\s*\{[^}]*background:\s*transparent/s);
  assert.match(styles, /\.comment-keyboard__key\s*\{[^}]*min-height:\s*44px/s);
  assert.match(player, /getSoundEnabledByUser/);
});
