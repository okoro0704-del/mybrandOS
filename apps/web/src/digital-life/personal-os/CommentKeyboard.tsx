import { memo, useCallback, useEffect, useRef } from "react";
import {
  COMMENT_LETTER_ROWS,
  COMMENT_SYMBOL_ROWS,
  canSendComment,
  type CommentKeyboardState,
  isCommentKeyboardOpen,
  letterForKeyboard,
} from "../../lib/commentKeyboard";

const BACKSPACE_REPEAT_MS = 70;
const BACKSPACE_DELAY_MS = 380;

export type CommentComposerInputMode = "internal" | "system";

type KeyAction =
  | { type: "char"; value: string }
  | { type: "space" }
  | { type: "backspace" }
  | { type: "shift" }
  | { type: "symbols" }
  | { type: "letters" }
  | { type: "send" }
  | { type: "close" }
  | { type: "paste" };

export const CommentKeyboard = memo(function CommentKeyboard({
  state,
  draft,
  busy,
  onAction,
}: {
  state: CommentKeyboardState;
  draft: string;
  busy: boolean;
  onAction: (action: KeyAction) => void;
}) {
  const holdRef = useRef(0);
  const delayRef = useRef(0);
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  const stopRepeat = useCallback(() => {
    window.clearInterval(holdRef.current);
    window.clearTimeout(delayRef.current);
    holdRef.current = 0;
    delayRef.current = 0;
  }, []);

  useEffect(() => () => stopRepeat(), [stopRepeat]);

  if (!isCommentKeyboardOpen(state)) return null;

  const symbols = state === "SYMBOLS";
  const shifted = state === "LETTERS_SHIFT";
  const rows = symbols ? COMMENT_SYMBOL_ROWS : COMMENT_LETTER_ROWS;
  const sendable = canSendComment(draft) && !busy;

  function press(action: KeyAction) {
    actionRef.current(action);
  }

  function onBackspaceDown(e: { preventDefault: () => void }) {
    e.preventDefault();
    press({ type: "backspace" });
    stopRepeat();
    delayRef.current = window.setTimeout(() => {
      holdRef.current = window.setInterval(() => {
        actionRef.current({ type: "backspace" });
      }, BACKSPACE_REPEAT_MS);
    }, BACKSPACE_DELAY_MS);
  }

  return (
    <div
      className="comment-keyboard"
      role="group"
      aria-label="Comment keyboard"
      data-keyboard-state={state}
      data-comment-keyboard="internal"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {rows.map((row, i) => (
        <div
          key={i}
          className={`comment-keyboard__row${i === 1 ? " comment-keyboard__row--mid" : ""}${i === 2 ? " comment-keyboard__row--bottom" : ""}`}
        >
          {i === 2 && !symbols ? (
            <KeyBtn label="Shift" wide onClick={() => press({ type: "shift" })} active={shifted}>
              ⇧
            </KeyBtn>
          ) : null}
          {row.map((glyph) => {
            const shown = symbols ? glyph : letterForKeyboard(glyph, state);
            return (
              <KeyBtn
                key={glyph}
                label={shown === '"' ? "Quote" : shown === "'" ? "Apostrophe" : shown.toUpperCase()}
                onClick={() => press({ type: "char", value: shown })}
              >
                {shown}
              </KeyBtn>
            );
          })}
          {i === 2 ? (
            <KeyBtn
              label="Backspace"
              wide
              onPointerDown={onBackspaceDown}
              onPointerUp={stopRepeat}
              onPointerCancel={stopRepeat}
              onPointerLeave={stopRepeat}
            >
              ⌫
            </KeyBtn>
          ) : null}
        </div>
      ))}
      <div className="comment-keyboard__row comment-keyboard__row--meta">
        {symbols ? (
          <KeyBtn label="Letters" wide onClick={() => press({ type: "letters" })}>
            ABC
          </KeyBtn>
        ) : (
          <KeyBtn label="Numbers" wide onClick={() => press({ type: "symbols" })}>
            123
          </KeyBtn>
        )}
        <KeyBtn label="Space" space onClick={() => press({ type: "space" })}>
          space
        </KeyBtn>
        {symbols ? (
          <KeyBtn label="Paste" onClick={() => press({ type: "paste" })}>
            Paste
          </KeyBtn>
        ) : (
          <KeyBtn label="Hide keyboard" onClick={() => press({ type: "close" })}>
            ⌄
          </KeyBtn>
        )}
        <KeyBtn label={busy ? "Posting" : "Send"} wide accent disabled={!sendable} onClick={() => press({ type: "send" })}>
          Send
        </KeyBtn>
      </div>
    </div>
  );
});

function KeyBtn({
  label,
  children,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
  wide,
  space,
  accent,
  active,
  disabled,
}: {
  label: string;
  children: string;
  onClick?: () => void;
  onPointerDown?: (e: { preventDefault: () => void }) => void;
  onPointerUp?: () => void;
  onPointerCancel?: () => void;
  onPointerLeave?: () => void;
  wide?: boolean;
  space?: boolean;
  accent?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`comment-keyboard__key${wide ? " is-wide" : ""}${space ? " is-space" : ""}${accent ? " is-accent" : ""}${active ? " is-active" : ""}`}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onPointerDown ? undefined : onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
    >
      <span aria-hidden>{children}</span>
    </button>
  );
}
