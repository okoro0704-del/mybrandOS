import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CREATE_LAUNCHER_TYPES,
  CREATE_MODES,
  PROJECT_TYPE_LABELS,
  type CreateLauncherType,
  type CreateMode,
} from "@mybrandos/shared";
import { api } from "../lib/api";
import { SoftwareInvitations } from "../software/SoftwareInvitations";

const MODE_LABELS: Record<CreateMode, string> = {
  MANUAL: "Manual Mode",
  AI: "Create with AI",
  IMPORT: "Import Existing",
};

export function CreatePage() {
  const [mode, setMode] = useState<CreateMode>("MANUAL");
  const [busy, setBusy] = useState<CreateLauncherType | null>(null);
  const navigate = useNavigate();

  async function launch(projectType: CreateLauncherType) {
    setBusy(projectType);
    try {
      const data = await api<{ project: { id: string } | null; redirect?: string }>("/create/projects", {
        method: "POST",
        body: JSON.stringify({ projectType, mode }),
      });
      if (mode === "IMPORT" || data.redirect === "/import") {
        navigate(
          projectType === "BOOK"
            ? "/import?as=book"
            : projectType === "COURSE"
              ? "/import?as=course"
              : projectType === "VIDEO"
                ? "/import?as=video"
                : projectType === "MUSIC"
                  ? "/import?as=music"
                  : projectType === "WRITING"
                    ? "/import?as=writing"
                    : projectType === "SOFTWARE"
                      ? "/import?as=software"
                      : "/import",
        );
      } else if (data.project) navigate(`/create/${data.project.id}${mode === "AI" ? "?ai=1" : ""}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Create</div>
        <h1>Start a project</h1>
        <p>
          Every type uses the same Creation Engine. Book, Course, Video, Music, Writing, and Software
          open specialized studios. Capture new media in{" "}
          <a href="/recording">Recording Studio</a>. Work manually, or ask AI when you want help.
        </p>
      </header>

      <SoftwareInvitations />

      <div className="mode-row">
        {CREATE_MODES.map((item) => (
          <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>
            {MODE_LABELS[item]}
          </button>
        ))}
      </div>

      <div className="launch-grid">
        {CREATE_LAUNCHER_TYPES.map((type) => (
          <button key={type} className="launch" onClick={() => void launch(type)} disabled={busy === type}>
            <b>{PROJECT_TYPE_LABELS[type]}</b>
            <span className="small muted">
              {type === "BOOK"
                ? mode === "IMPORT"
                  ? "Import a manuscript into Book Studio."
                  : mode === "AI"
                    ? "Open Book Studio with an optional outline."
                    : "Open Book Studio."
                : type === "COURSE"
                  ? mode === "IMPORT"
                    ? "Import course materials into Course Studio."
                    : mode === "AI"
                      ? "Open Course Studio with an optional outline."
                      : "Open Course Studio."
                : type === "VIDEO"
                  ? mode === "IMPORT"
                    ? "Import a video into Video Studio."
                    : mode === "AI"
                      ? "Open Video Studio. AI is optional."
                      : "Open Video Studio."
                  : type === "MUSIC"
                    ? mode === "IMPORT"
                      ? "Import audio into Music Studio."
                      : mode === "AI"
                        ? "Open Music Studio. AI is optional."
                        : "Open Music Studio."
                    : type === "WRITING"
                      ? mode === "IMPORT"
                        ? "Import text or Markdown into Writing Studio."
                        : mode === "AI"
                          ? "Open Writing Studio. AI is optional."
                          : "Open Writing Studio."
                      : type === "SOFTWARE"
                        ? mode === "IMPORT"
                          ? "Import project files into Software Studio."
                          : mode === "AI"
                            ? "Open Software Studio. AI is optional."
                            : "Open Software Studio."
                : mode === "IMPORT"
                  ? "Import as a first-class project."
                  : mode === "AI"
                    ? "Open the workspace with AI ready."
                    : "Open a blank workspace."}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
