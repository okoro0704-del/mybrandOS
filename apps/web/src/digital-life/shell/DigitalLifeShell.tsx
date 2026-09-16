import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { studioPath, type PublicBrandExperience } from "@mybrandos/shared";
import { applyBrandDocument, clearBrandDocument } from "../branding";
import { InstallPrompt } from "../install/InstallPrompt";
import { registerDigitalLifeServiceWorker } from "../pwa/registerDigitalLifeSw";
import { DigitalLifeBottomNav, DigitalLifeTopBar } from "../navigation/Chrome";
import { BottomSheet } from "../personal-os/BottomSheet";
import { UtilityDock } from "../personal-os/UtilityDock";
import { communitiesPath } from "../routes";

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
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const theme = experience.theme;

  useEffect(() => {
    applyBrandDocument(experience, { assetTitle });
    void registerDigitalLifeServiceWorker();
    return () => clearBrandDocument();
  }, [experience, assetTitle]);

  useEffect(() => {
    setMenuOpen(false);
    setNotifyOpen(false);
    setMessagesOpen(false);
  }, [primary]);

  return (
    <div
      className={`brand-exp digital-life-app digital-life-surface personal-os surface-${primary === "website" ? "website" : "app"}`}
      data-bg={theme.background}
      data-surface={preview ? "studio-preview" : primary === "website" ? "website" : "public_app"}
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
          <Link to={studioPath("/brand", window.location.hostname)}>Back to Brand</Link>
        </div>
      ) : null}

      <div className="os-phone-frame">
        <DigitalLifeTopBar
          experience={experience}
          basePath={basePath}
          mediaBase={mediaBase}
          websiteBase={websiteBase}
          primary={primary}
          menuOpen={menuOpen}
          onToggleMenu={() => setMenuOpen((v) => !v)}
        />

        <main className="dl-main be-main os-main">{children}</main>

        {!preview ? <InstallPrompt experience={experience} /> : null}

        <UtilityDock
          experience={experience}
          basePath={basePath}
          onNotifications={() => setNotifyOpen(true)}
          onMessages={() => setMessagesOpen(true)}
        />

        <DigitalLifeBottomNav basePath={basePath} websiteBase={websiteBase} primary={primary} />
      </div>

      <BottomSheet open={notifyOpen} title="Notifications" onClose={() => setNotifyOpen(false)}>
        <p className="os-sheet__empty">
          {/* TEMP_FALLBACK: public notification inbox API not exposed yet */}
          No notifications yet. Activity from this Digital Life will appear here.
        </p>
      </BottomSheet>

      <BottomSheet open={messagesOpen} title="Messages" onClose={() => setMessagesOpen(false)}>
        {experience.messaging.available ? (
          <div className="os-sheet__stack">
            <p>Messaging is available for this Digital Life.</p>
            <Link className="os-btn" to={communitiesPath(basePath)} onClick={() => setMessagesOpen(false)}>
              Open community messaging
            </Link>
          </div>
        ) : (
          <p className="os-sheet__empty">
            {experience.messaging.detail || "Messages open when messaging is enabled for this Digital Life."}
          </p>
        )}
      </BottomSheet>
    </div>
  );
}
