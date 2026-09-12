import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ASSET_TYPE_LABELS,
  DEFAULT_PUBLISH_RIGHTS,
  PUBLISH_CONTENT_FORMATS,
  PUBLISH_CONTENT_FORMAT_DETAILS,
  PUBLISH_CONTENT_FORMAT_LABELS,
  PUBLISH_SOURCE_DETAILS,
  PUBLISH_SOURCE_LABELS,
  PUBLISH_VISIBILITIES,
  PUBLISH_VISIBILITY_LABELS,
  TITLE_MAX_CHARS,
  WRITEUP_MAX_CHARS,
  type PublishCandidate,
  type PublishCategoryId,
  type PublishCategoryInfo,
  type PublishContentFormat,
  type PublishDistributionSummaryItem,
  type PublishExecuteResult,
  type PublishExternalSite,
  type PublishRights,
  type PublishScheduleMode,
  type PublishSourceAvailability,
  type PublishSourceId,
  type PublishVisibility,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";

type Step =
  | "landing"
  | "format"
  | "source"
  | "select"
  | "details"
  | "schedule"
  | "privacy"
  | "review"
  | "done"
  | "distribute";

type DriveFile = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export function PublishCenterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("landing");
  const [categories, setCategories] = useState<PublishCategoryInfo[]>([]);
  const [sources, setSources] = useState<PublishSourceAvailability[]>([]);
  const [category, setCategory] = useState<PublishCategoryId | null>(null);
  const [format, setFormat] = useState<PublishContentFormat | null>(null);
  const [source, setSource] = useState<PublishSourceId | null>(null);
  const [candidates, setCandidates] = useState<PublishCandidate[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublishCandidate | null>(null);
  const [title, setTitle] = useState("");
  const [writeup, setWriteup] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [scheduleMode, setScheduleMode] = useState<PublishScheduleMode>("now");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [visibility, setVisibility] = useState<PublishVisibility>("public");
  const [rights, setRights] = useState<PublishRights>({ ...DEFAULT_PUBLISH_RIGHTS });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PublishExecuteResult | null>(null);
  const [summary, setSummary] = useState<PublishDistributionSummaryItem[]>([]);
  const [externalSites, setExternalSites] = useState<PublishExternalSite[]>([]);
  const [pickedDestinations, setPickedDestinations] = useState<string[]>([]);
  const [siteName, setSiteName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [distributeDetail, setDistributeDetail] = useState("");

  useEffect(() => {
    void api<{ categories: PublishCategoryInfo[]; sources: PublishSourceAvailability[] }>("/publish/center")
      .then((data) => {
        setCategories(data.categories);
        setSources(data.sources);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load Publish Center."));
  }, []);

  const tags = useMemo(
    () =>
      tagsRaw
        .split(/[,\s#]+/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 12),
    [tagsRaw],
  );

  function goBack() {
    const order: Step[] = ["landing", "format", "source", "select", "details", "schedule", "privacy", "review", "done", "distribute"];
    const idx = order.indexOf(step);
    if (step === "format") return setStep("landing");
    if (step === "source" && category === "content") return setStep("format");
    if (step === "source") return setStep("landing");
    if (step === "select") return setStep("source");
    if (step === "details") return setStep("select");
    if (step === "schedule") return setStep("details");
    if (step === "privacy") return setStep("schedule");
    if (step === "review") return setStep("privacy");
    if (step === "distribute") return setStep("done");
    if (idx > 0) setStep(order[idx - 1]!);
  }

  async function chooseCategory(item: PublishCategoryInfo) {
    setError("");
    if (item.id === "live") {
      navigate("/live");
      return;
    }
    setCategory(item.id);
    setFormat(null);
    setSource(null);
    setSelectedId(null);
    setSelected(null);
    if (item.id === "content") setStep("format");
    else setStep("source");
  }

  async function loadCandidates(nextSource: PublishSourceId, nextFormat?: PublishContentFormat | null) {
    if (!category) return;
    setBusy(true);
    setError("");
    try {
      if (nextSource === "external") {
        setCandidates([]);
        setDriveFiles([]);
        setStep("select");
        return;
      }
      if (nextSource === "drive") {
        const drive = await api<{ files: DriveFile[]; detail: string }>("/publish/drive");
        setDriveFiles(drive.files);
        const data = await api<{ candidates: PublishCandidate[] }>(
          `/publish/candidates?category=${category}&source=drive${nextFormat ? `&format=${nextFormat}` : ""}`,
        );
        setCandidates(data.candidates);
      } else {
        const data = await api<{ candidates: PublishCandidate[] }>(
          `/publish/candidates?category=${category}&source=drafts${nextFormat ? `&format=${nextFormat}` : ""}`,
        );
        setCandidates(data.candidates);
        setDriveFiles([]);
      }
      setStep("select");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load content.");
    } finally {
      setBusy(false);
    }
  }

  function chooseSource(id: PublishSourceId) {
    const info = sources.find((item) => item.id === id);
    if (info && !info.available) {
      setError(info.reason || "Unavailable");
      return;
    }
    setSource(id);
    void loadCandidates(id, format);
  }

  function chooseCandidate(item: PublishCandidate) {
    setSelectedId(item.id);
    setSelected(item);
    setTitle(item.title.slice(0, TITLE_MAX_CHARS));
    setWriteup("");
    setStep("details");
  }

  async function chooseDriveFile(file: DriveFile) {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ candidate: PublishCandidate }>(`/publish/drive/${file.id}/select`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      chooseCandidate(data.candidate);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not select Drive file.");
    } finally {
      setBusy(false);
    }
  }

  async function importExternal() {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ asset: PublishCandidate & { id: string; title: string } }>("/publish/external/url", {
        method: "POST",
        body: JSON.stringify({ url: externalUrl }),
      });
      const asset = (data as { asset: PublishCandidate }).asset;
      chooseCandidate({
        id: asset.id,
        title: asset.title,
        assetType: asset.assetType,
        status: asset.status ?? "DRAFT",
        visibility: asset.visibility ?? "private",
        origin: asset.origin ?? "IMPORTED_URL",
        createdAt: asset.createdAt ?? new Date().toISOString(),
        updatedAt: asset.updatedAt ?? new Date().toISOString(),
        coverAvailable: Boolean(asset.dataZoneId),
        sourceProjectId: asset.sourceProjectId ?? null,
        dataZoneId: asset.dataZoneId ?? null,
        presentationTypes: asset.presentationTypes ?? [],
        detail: "Imported",
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!selected || !category) return;
    setBusy(true);
    setError("");
    try {
      const scheduledAt =
        scheduleMode === "schedule" && scheduledDate
          ? new Date(`${scheduledDate}T${scheduledTime || "09:00"}:00`).toISOString()
          : null;
      const data = await api<PublishExecuteResult>("/publish/execute", {
        method: "POST",
        body: JSON.stringify({
          assetId: selected.id,
          title,
          writeup,
          tags,
          visibility,
          rights,
          scheduleMode,
          scheduledAt,
          contentFormat: format,
          category,
        }),
      });
      setResult(data);
      setStep("done");
      if (data.status === "PUBLISHED") {
        const dist = await api<{ items: PublishDistributionSummaryItem[]; externalSites: PublishExternalSite[] }>(
          `/publish/${data.assetId}/distribution`,
        );
        setSummary(dist.items);
        setExternalSites(dist.externalSites);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Publish failed.");
    } finally {
      setBusy(false);
    }
  }

  async function addSite() {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ site: PublishExternalSite }>("/publish/external-sites", {
        method: "POST",
        body: JSON.stringify({ name: siteName, url: siteUrl }),
      });
      setExternalSites([...externalSites, data.site]);
      if (result) {
        const dist = await api<{ items: PublishDistributionSummaryItem[]; externalSites: PublishExternalSite[] }>(
          `/publish/${result.assetId}/distribution`,
        );
        setSummary(dist.items);
        setExternalSites(dist.externalSites);
      }
      setSiteName("");
      setSiteUrl("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add site.");
    } finally {
      setBusy(false);
    }
  }

  async function distribute() {
    if (!result) return;
    setBusy(true);
    setError("");
    setDistributeDetail("");
    try {
      const data = await api<{ results: Array<{ destination: string; ok: boolean; detail: string }> }>(
        `/publish/${result.assetId}/distribute`,
        { method: "POST", body: JSON.stringify({ destinations: pickedDestinations }) },
      );
      setDistributeDetail(
        data.results.map((item) => `${item.destination}: ${item.ok ? "ok" : "failed"} — ${item.detail}`).join(" · "),
      );
      const dist = await api<{ items: PublishDistributionSummaryItem[]; externalSites: PublishExternalSite[] }>(
        `/publish/${result.assetId}/distribution`,
      );
      setSummary(dist.items);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Distribution failed.");
    } finally {
      setBusy(false);
    }
  }

  const headerTitle =
    step === "landing"
      ? "Publish"
      : step === "format"
        ? "Content"
        : step === "source"
          ? "Content Source"
          : step === "select"
            ? "Selected Content"
            : step === "details"
              ? "Content Details"
              : step === "schedule"
                ? "Schedule"
                : step === "privacy"
                  ? "Privacy & Rights"
                  : step === "review"
                    ? "Review & Publish"
                    : step === "done"
                      ? "Published!"
                      : "Distribute";

  return (
    <section className="page publish-center">
      <header className="publish-head">
        {step !== "landing" && step !== "done" ? (
          <button type="button" className="publish-back" onClick={goBack} aria-label="Back">
            ←
          </button>
        ) : (
          <span className="publish-back-spacer" />
        )}
        <h1>{headerTitle}</h1>
        <span className="publish-back-spacer" />
      </header>

      {error ? <p className="placeholder-note">{error}</p> : null}

      {step === "landing" ? (
        <div className="publish-landing">
          <div className="publish-hero-icon" aria-hidden>
            ⌂
          </div>
          <h2>Publish</h2>
          <p className="muted">Share your existing content with your world.</p>
          <p className="small muted">Create makes content. Publish makes it live.</p>
          <div className="publish-list">
            {categories.map((item) => (
              <button key={item.id} type="button" className="publish-row" onClick={() => void chooseCategory(item)}>
                <span>
                  <strong>{item.label}</strong>
                  <span className="small muted">{item.detail}</span>
                </span>
                <span className="publish-chevron">›</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {step === "format" ? (
        <div className="publish-list">
          {PUBLISH_CONTENT_FORMATS.map((id) => (
            <button
              key={id}
              type="button"
              className="publish-row"
              onClick={() => {
                setFormat(id);
                setStep("source");
              }}
            >
              <span>
                <strong>{PUBLISH_CONTENT_FORMAT_LABELS[id]}</strong>
                <span className="small muted">{PUBLISH_CONTENT_FORMAT_DETAILS[id]}</span>
              </span>
              <span className="publish-chevron">›</span>
            </button>
          ))}
        </div>
      ) : null}

      {step === "source" ? (
        <div className="publish-source">
          <p className="muted">Where is your content coming from?</p>
          {sources.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`publish-source-card${item.available ? "" : " disabled"}`}
              disabled={!item.available || busy}
              onClick={() => chooseSource(item.id)}
            >
              <strong>{PUBLISH_SOURCE_LABELS[item.id]}</strong>
              <span className="small muted">{PUBLISH_SOURCE_DETAILS[item.id]}</span>
              <span className="chip">{item.connection}</span>
              {item.reason ? <span className="small muted">{item.reason}</span> : null}
            </button>
          ))}
          <p className="small muted publish-privacy-note">Your content remains yours. You control where it is published.</p>
        </div>
      ) : null}

      {step === "select" ? (
        <div className="publish-select">
          {source === "external" ? (
            <article className="panel">
              <div className="eyebrow">From External</div>
              <label className="field">
                URL
                <input value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://" />
              </label>
              <button className="btn" disabled={busy || !externalUrl.trim()} onClick={() => void importExternal()}>
                {busy ? "Importing…" : "Import URL"}
              </button>
              <p className="small muted">Unsupported providers stay Unavailable. Nothing is fabricated.</p>
              <Link className="btn ghost" to="/import">
                Open Import
              </Link>
            </article>
          ) : null}

          {source === "drive" && driveFiles.length ? (
            <>
              <p className="small muted">DataZone project files</p>
              {driveFiles.map((file) => (
                <button key={file.id} type="button" className="publish-row" onClick={() => void chooseDriveFile(file)}>
                  <span>
                    <strong>{file.filename}</strong>
                    <span className="small muted">
                      {file.mimeType} · {Math.max(1, Math.round(file.sizeBytes / 1024))} KB
                    </span>
                  </span>
                  <span className="publish-chevron">›</span>
                </button>
              ))}
            </>
          ) : null}

          {candidates.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`publish-row${selectedId === item.id ? " selected" : ""}`}
              onClick={() => chooseCandidate(item)}
            >
              <span>
                <strong>{item.title}</strong>
                <span className="small muted">
                  {ASSET_TYPE_LABELS[item.assetType]} · {item.detail} · {new Date(item.updatedAt).toLocaleDateString()}
                </span>
              </span>
              <span className="publish-chevron">›</span>
            </button>
          ))}

          {!busy && source !== "external" && !candidates.length && !(source === "drive" && driveFiles.length) ? (
            <p className="muted">No unpublished content in this category. Create first, then publish here.</p>
          ) : null}
          {busy ? <p className="muted">Loading…</p> : null}
        </div>
      ) : null}

      {step === "details" && selected ? (
        <div className="publish-details">
          <article className="panel">
            <div className="eyebrow">{ASSET_TYPE_LABELS[selected.assetType]}</div>
            <strong>{selected.title}</strong>
            <p className="small muted">{selected.detail}</p>
          </article>
          <label className="field">
            Title
            <input
              value={title}
              maxLength={TITLE_MAX_CHARS}
              onChange={(e) => setTitle(e.target.value)}
            />
            <span className="small muted">
              {title.length}/{TITLE_MAX_CHARS}
            </span>
          </label>
          <label className="field">
            Writeup / Description
            <textarea
              rows={4}
              value={writeup}
              maxLength={WRITEUP_MAX_CHARS}
              onChange={(e) => setWriteup(e.target.value)}
              placeholder="Add the publishing message for this content."
            />
            <span className="small muted">
              {writeup.length}/{WRITEUP_MAX_CHARS}
            </span>
          </label>
          <label className="field">
            Tags
            <input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="#motivation #lifestyle" />
          </label>
          {tags.length ? (
            <div className="publish-tags">
              {tags.map((tag) => (
                <span className="chip" key={tag}>
                  #{tag}
                </span>
              ))}
            </div>
          ) : null}
          <button className="btn" onClick={() => setStep("schedule")}>
            Continue
          </button>
        </div>
      ) : null}

      {step === "schedule" ? (
        <div className="publish-schedule">
          <label className={`publish-radio${scheduleMode === "now" ? " on" : ""}`}>
            <input
              type="radio"
              name="schedule"
              checked={scheduleMode === "now"}
              onChange={() => setScheduleMode("now")}
            />
            <span>
              <strong>Publish Now</strong>
              <span className="small muted">Make it live immediately.</span>
            </span>
          </label>
          <label className={`publish-radio${scheduleMode === "schedule" ? " on" : ""}`}>
            <input
              type="radio"
              name="schedule"
              checked={scheduleMode === "schedule"}
              onChange={() => setScheduleMode("schedule")}
            />
            <span>
              <strong>Schedule</strong>
              <span className="small muted">Choose a future date and time. Recurring is not supported yet.</span>
            </span>
          </label>
          {scheduleMode === "schedule" ? (
            <div className="publish-schedule-fields">
              <label className="field">
                Date
                <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
              </label>
              <label className="field">
                Time
                <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
              </label>
              <p className="small muted">Timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>
            </div>
          ) : null}
          <button
            className="btn"
            disabled={scheduleMode === "schedule" && !scheduledDate}
            onClick={() => setStep("privacy")}
          >
            Continue
          </button>
        </div>
      ) : null}

      {step === "privacy" ? (
        <div className="publish-privacy">
          <div className="eyebrow">Visibility</div>
          {PUBLISH_VISIBILITIES.map((id) => (
            <label key={id} className={`publish-radio${visibility === id ? " on" : ""}`}>
              <input type="radio" name="vis" checked={visibility === id} onChange={() => setVisibility(id)} />
              <span>
                <strong>{PUBLISH_VISIBILITY_LABELS[id]}</strong>
                <span className="small muted">
                  {id === "public"
                    ? "Visible on your public Digital Life when Brand is public."
                    : id === "unlisted"
                      ? "Not listed on public surfaces; direct access still respects server rules."
                      : "Stays private. Public APIs will not expose it."}
                </span>
              </span>
            </label>
          ))}
          <div className="eyebrow" style={{ marginTop: 16 }}>
            Usage rights
          </div>
          {(
            [
              ["allowEmbedding", "Allow embedding"],
              ["allowSharing", "Allow sharing"],
              ["allowReuse", "Allow reuse (with credit)"],
              ["allowDownload", "Allow download"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="publish-toggle">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={rights[key]}
                onChange={(e) => setRights({ ...rights, [key]: e.target.checked })}
              />
            </label>
          ))}
          <button className="btn" onClick={() => setStep("review")}>
            Continue
          </button>
        </div>
      ) : null}

      {step === "review" && selected ? (
        <div className="publish-review">
          <article className="panel">
            <div className="eyebrow">Summary</div>
            <p>
              <strong>{title || selected.title}</strong>
            </p>
            <p className="muted">{writeup || "No writeup"}</p>
            <dl className="publish-summary">
              <div>
                <dt>Type</dt>
                <dd>{ASSET_TYPE_LABELS[selected.assetType]}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{source ? PUBLISH_SOURCE_LABELS[source] : "—"}</dd>
              </div>
              <div>
                <dt>Schedule</dt>
                <dd>
                  {scheduleMode === "now"
                    ? "Publish Now"
                    : `${scheduledDate} ${scheduledTime} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`}
                </dd>
              </div>
              <div>
                <dt>Visibility</dt>
                <dd>{PUBLISH_VISIBILITY_LABELS[visibility]}</dd>
              </div>
              <div>
                <dt>Rights</dt>
                <dd>
                  {[
                    rights.allowEmbedding ? "embed" : null,
                    rights.allowSharing ? "share" : null,
                    rights.allowReuse ? "reuse" : null,
                    rights.allowDownload ? "download" : null,
                  ]
                    .filter(Boolean)
                    .join(", ") || "none"}
                </dd>
              </div>
              <div>
                <dt>Tags</dt>
                <dd>{tags.length ? tags.map((t) => `#${t}`).join(" ") : "—"}</dd>
              </div>
            </dl>
          </article>
          <button className="btn" disabled={busy} onClick={() => void publish()}>
            {busy ? "Publishing…" : scheduleMode === "now" ? "Publish Now" : "Schedule Publish"}
          </button>
        </div>
      ) : null}

      {step === "done" && result ? (
        <div className="publish-done">
          <div className="publish-success-mark" aria-hidden>
            ✓
          </div>
          <h2>{result.status === "SCHEDULED" ? "Scheduled" : "Published!"}</h2>
          <p className="muted">{result.detail}</p>
          {result.publicPath ? (
            <Link className="btn" to={result.publicPath}>
              View in mybrandOS
            </Link>
          ) : (
            <Link className="btn" to="/brand/preview">
              View in mybrandOS
            </Link>
          )}
          {result.status === "PUBLISHED" ? (
            <button className="btn ghost" onClick={() => setStep("distribute")}>
              Distribute to External Platforms
            </button>
          ) : null}
          <div className="publish-next">
            <p className="small muted">Next</p>
            <button type="button" className="publish-row" onClick={() => setStep("distribute")}>
              Distribute
            </button>
            <Link className="publish-row" to="/create">
              Create another
            </Link>
          </div>
        </div>
      ) : null}

      {step === "distribute" && result ? (
        <div className="publish-distribute">
          <p className="muted">Share your published content to external platforms.</p>
          <article className="panel">
            <div className="eyebrow">Distribution summary</div>
            {summary.map((item) => (
              <div className="list-row" key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <div className="small muted">{item.detail}</div>
                </div>
                <span className="chip">
                  {item.state === "published" || item.state === "connected" || item.state === "configured" || item.state === "eligible"
                    ? "✓"
                    : "○"}{" "}
                  {item.state.replace("_", " ")}
                </span>
              </div>
            ))}
          </article>

          <div className="eyebrow">Destinations</div>
          {summary
            .filter((item) => item.id !== "mybrandos" && item.id !== "lifeos")
            .map((item) => {
              const value = item.id;
              const checked = pickedDestinations.includes(value);
              const disabled = item.state === "not_connected" || item.state === "unavailable";
              return (
                <label key={item.id} className={`publish-toggle${disabled ? " disabled" : ""}`}>
                  <span>
                    {item.label}
                    {disabled ? <span className="small muted"> — Not Connected</span> : null}
                  </span>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={checked}
                    onChange={(e) =>
                      setPickedDestinations(
                        e.target.checked
                          ? [...pickedDestinations, value]
                          : pickedDestinations.filter((id) => id !== value),
                      )
                    }
                  />
                </label>
              );
            })}

          <article className="panel" style={{ marginTop: 16 }}>
            <div className="eyebrow">Add External Site</div>
            <label className="field">
              Website Name
              <input value={siteName} onChange={(e) => setSiteName(e.target.value)} />
            </label>
            <label className="field">
              Website URL
              <input value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} placeholder="https://example.com" />
            </label>
            <button className="btn ghost" disabled={busy} onClick={() => void addSite()}>
              Add Site
            </button>
          </article>

          <button className="btn" disabled={busy || !pickedDestinations.length} onClick={() => void distribute()}>
            {busy ? "Distributing…" : "Distribute Now"}
          </button>
          {distributeDetail ? <p className="placeholder-note">{distributeDetail}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
