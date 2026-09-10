import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PublicBrandExperience } from "@mybrandos/shared";
import { applyBrandDocument, clearBrandDocument } from "../branding";
import { InstallPrompt } from "../install/InstallPrompt";
import { registerDigitalLifeServiceWorker } from "../pwa/registerDigitalLifeSw";
import { DigitalLifeBottomNav, DigitalLifeTopBar } from "../navigation/Chrome";

export function DigitalLifeShell({
  experience,
  basePath,
  mediaBase,
  websiteBase,
  primary,
  preview,
  assetTitle,
  children,
}: {
  experience: PublicBrandExperience;
  basePath: string;
  mediaBase: string;
  websiteBase: string;
  primary: string;
  preview?: boolean;
  assetTitle?: string;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = experience.theme;

  useEffect(() => {
    applyBrandDocument(experience, { assetTitle });
    void registerDigitalLifeServiceWorker();
    return () => clearBrandDocument();
  }, [experience, assetTitle]);

  useEffect(() => {
    setMenuOpen(false);
  }, [primary]);

  return (
    <div
      className={`brand-exp digital-life-app digital-life-surface surface-${primary === "website" ? "website" : "app"}`}
      data-bg={theme.background}
      data-accent={theme.accent}
      data-type={theme.typography}
      data-buttons={theme.buttons}
      data-density={theme.density}
    >
      {preview ? (
        <div className="be-preview-bar">
          <span>PREVIEW — drafts stay private. This is not the public surface.</span>
          <span className="small">
            {experience.publicEnabled ? "PUBLIC is on for visitors." : "Still PRIVATE to visitors."}
          </span>
          <Link to="/brand">Back to Brand</Link>
        </div>
      ) : null}

      <DigitalLifeTopBar
        experience={experience}
        basePath={basePath}
        mediaBase={mediaBase}
        websiteBase={websiteBase}
        primary={primary}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((v) => !v)}
      />

      <main className="dl-main be-main">{children}</main>

      {!preview ? <InstallPrompt experience={experience} /> : null}

      <DigitalLifeBottomNav basePath={basePath} websiteBase={websiteBase} primary={primary} />
    </div>
  );
}
