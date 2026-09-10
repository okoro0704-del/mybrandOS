import { useCallback, useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallAvailability = "INSTALLABLE" | "ALREADY_INSTALLED" | "NOT_SUPPORTED" | "DEFERRED" | "IOS_GUIDE";

function dismissedKey(slug: string) {
  return `mybrandos_dl_install_dismissed:${slug}`;
}

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function useInstallPrompt(slug: string) {
  const [availability, setAvailability] = useState<InstallAvailability>("DEFERRED");
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (isStandalone()) {
      setAvailability("ALREADY_INSTALLED");
      return;
    }
    if (localStorage.getItem(dismissedKey(slug)) === "1") {
      setAvailability("DEFERRED");
      return;
    }
    if (isIos()) {
      setAvailability("IOS_GUIDE");
      return;
    }

    const onBip = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setAvailability("INSTALLABLE");
    };
    window.addEventListener("beforeinstallprompt", onBip);
    // Chromium may never fire; stay deferred until then.
    const timer = window.setTimeout(() => {
      setAvailability((prev) => (prev === "DEFERRED" ? "NOT_SUPPORTED" : prev));
    }, 4000);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.clearTimeout(timer);
    };
  }, [slug]);

  const dismiss = useCallback(() => {
    localStorage.setItem(dismissedKey(slug), "1");
    setAvailability("DEFERRED");
    setShowGuide(false);
  }, [slug]);

  const promptInstall = useCallback(async () => {
    if (availability === "IOS_GUIDE") {
      setShowGuide(true);
      return;
    }
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    setDeferred(null);
    if (choice.outcome === "accepted") {
      setAvailability("ALREADY_INSTALLED");
    } else {
      dismiss();
    }
  }, [availability, deferred, dismiss]);

  return {
    availability,
    showGuide,
    setShowGuide,
    promptInstall,
    dismiss,
    standalone: isStandalone(),
  };
}
