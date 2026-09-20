import { useEffect, useRef, useState } from "react";
import { initialsFrom } from "./osIdentity";
import type { PublicComment } from "./PostComments";
import { prefersReducedMotion } from "../../lib/immersiveFeedController";

export const FLOATING_COMMENT_MS = 7200;
export const FLOATING_COMMENT_SPAWN_MS = 2400;

type Floater = {
  key: string;
  comment: PublicComment;
  x: number;
};

/** Comments drift up over playing media. No sheet, no pause, no remount. */
export function FloatingComments({
  comments,
  active,
}: {
  comments: PublicComment[];
  active: boolean;
}) {
  const [items, setItems] = useState<Floater[]>([]);
  const indexRef = useRef(0);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (!active || comments.length === 0) {
      setItems([]);
      indexRef.current = 0;
      return;
    }

    function spawn() {
      const comment = comments[indexRef.current % comments.length];
      if (!comment) return;
      indexRef.current += 1;
      const x = 4 + ((indexRef.current * 19) % 48);
      const key = `${comment.id}-${indexRef.current}`;
      setItems((prev) => [...prev.slice(-6), { key, comment, x }]);
    }

    spawn();
    const t = window.setInterval(spawn, reduced ? FLOATING_COMMENT_MS : FLOATING_COMMENT_SPAWN_MS);
    return () => window.clearInterval(t);
  }, [active, comments, reduced]);

  if (!active) return null;

  return (
    <div className="floating-comments" aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <article
          key={item.key}
          className={`floating-comment${reduced ? " floating-comment--static" : ""}`}
          style={{ left: `${item.x}%`, animationDuration: `${FLOATING_COMMENT_MS}ms` }}
          onAnimationEnd={() => {
            setItems((prev) => prev.filter((row) => row.key !== item.key));
          }}
        >
          <span className="floating-comment__avatar" aria-hidden>
            {initialsFrom(item.comment.displayName)}
          </span>
          <span className="floating-comment__copy">
            <strong>{item.comment.displayName.replace(/^@/, "")}</strong>
            <span>{item.comment.body}</span>
          </span>
        </article>
      ))}
    </div>
  );
}
