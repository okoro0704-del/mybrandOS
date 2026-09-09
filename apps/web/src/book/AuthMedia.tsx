import { useEffect, useState } from "react";
import { authObjectUrl } from "../lib/media";

export function AuthMedia({
  path,
  alt,
  className,
}: {
  path: string;
  alt: string;
  className?: string;
}) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let cancelled = false;
    void authObjectUrl(path)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!src) return <div className={`muted small ${className ?? ""}`}>Loading image…</div>;
  return <img src={src} alt={alt} className={className} />;
}

export function AuthAudio({ path, className }: { path: string; className?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let cancelled = false;
    void authObjectUrl(path)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!src) return <p className="muted small">Loading audio…</p>;
  return <audio className={className} src={src} controls />;
}

export function AuthVideo({ path, className }: { path: string; className?: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let cancelled = false;
    void authObjectUrl(path)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path]);
  if (!src) return <p className="muted small">Loading preview…</p>;
  return <video className={className} src={src} controls playsInline />;
}
