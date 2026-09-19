import { Link } from "react-router-dom";
import { personalOsName } from "./osIdentity";

/** Data-driven creator OS signature — stem from slug, suffix always the green OS token. */
export function OsWordmark({
  slug,
  displayName,
  to,
  className = "",
  hidden = false,
  identity = false,
}: {
  slug: string;
  displayName?: string;
  to: string;
  className?: string;
  hidden?: boolean;
  /** Quiet OS mark — not a navigation control. */
  identity?: boolean;
}) {
  const os = personalOsName(slug, displayName);
  const inner = (
    <>
      <span className="os-wordmark__stem">{os.stem}</span>
      <span className="os-wordmark__os">OS</span>
    </>
  );
  const cls = `os-wordmark${className ? ` ${className}` : ""}`;
  if (identity) {
    return (
      <p
        className={cls}
        aria-label={hidden ? undefined : os.full}
        aria-hidden={hidden || undefined}
        data-os-wordmark="true"
      >
        {inner}
      </p>
    );
  }
  return (
    <Link
      className={cls}
      to={to}
      aria-label={os.full}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      data-os-wordmark="true"
    >
      {inner}
    </Link>
  );
}
