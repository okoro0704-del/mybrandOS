import { AppLink as Link, useAppNavigate as useNavigate } from "../lib/paths";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ASSET_TYPE_LABELS,
  DEFAULT_PUBLISH_RIGHTS,
  PUBLISH_AUDIENCES,
  PUBLISH_AUDIENCE_DETAILS,
  PUBLISH_AUDIENCE_LABELS,
  PUBLISH_VISIBILITIES,
  PUBLISH_VISIBILITY_LABELS,
  WRITEUP_MAX_CHARS,
  type PresentationType,
  type PublishAudience,
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
import { ApiError, api, uploadForm } from "../lib/api";
import {
  SOURCE_TAB_IDS,
  SOURCE_TAB_LABELS,
  candidateFromImportedAsset,
  createLocalMediaPreview,
  inferPublishFormat,
  revokeLocalMediaPreview,
  usageRightsLabel,
  type LocalMediaPreview,
} from "../publish/contentSource";

type Step = "landing" | "source" | "setup" | "review" | "done" | "distribute";
type SetupPanel = null | "schedule" | "audience" | "visibility" | "rights";
type UploadState = "idle" | "uploading" | "processing" | "ready" | "failed";

type DriveFile = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

type ImportedAsset = {
  id: string;
  title: string;
  assetType: string;
  status: string;
  visibility: string;
  origin: string;
  dataZoneId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  sourceProjectId?: string | null;
};

export function PublishCenterPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("landing");
  const [categories, setCategories] = useState<PublishCategoryInfo[]>([]);
  const [sources, setSources] = useState<PublishSourceAvailability[]>([]);
  const [category, setCategory] = useState<PublishCategoryId | null>(null);
  const [format, setFormat] = useState<PublishContentFormat | null>(null);
  const [source, setSource] = useState<PublishSourceId>("drafts");
  const [candidates, setCandidates] = useState<PublishCandidate[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublishCandidate | null>(null);
  const [writeup, setWriteup] = useState("");
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
  const [distributeDetail, setDistributeDetail] = useState("");
  const [presentationTypes, setPresentationTypes] = useState<PresentationType[]>([]);
  const [audience, setAudience] = useState<PublishAudience>("FREE");
  const [setupPanel, setSetupPanel] = useState<SetupPanel>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [uploadPercent, setUploadPercent] = useState<number | null>(null);
  const [preview, setPreview] = useState<LocalMediaPreview | null>(null);
  const pendingFile = useRef<File | null>(null);
  const loadSeq = useRef(0);

  useEffect(() => {
    void api<{ categories: PublishCategoryInfo[]; sources: PublishSourceAvailability[] }>("/publish/center")
      .then((data) => {
        setCategories(data.categories);
        setSources(data.sources);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load Publish Center."));
  }, []);

  useEffect(() => {
    return () => revokeLocalMediaPreview(preview?.url);
  }, [preview]);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const canonicalReady = Boolean(selected) && uploadState !== "uploading" && uploadState !== "processing" && uploadState !== "failed";
  const scheduleReady = scheduleMode === "now" || Boolean(scheduledDate);
  const scheduleLabel =
    scheduleMode === "now" ? "Now" : scheduledDate ? `${scheduledDate} ${scheduledTime}` : "Choose time";

  function clearPreview() {
    revokeLocalMediaPreview(preview?.url);
    setPreview(null);
    pendingFile.current = null;
  }

  function clearSelection() {
    setSelected(null);
    setSelectedId(null);
    setFormat(null);
    setPresentationTypes([]);
    setUploadState("idle");
    setUploadPercent(null);
    clearPreview();
  }

  function goBack() {
    if (step === "source") return setStep("landing");
    if (step === "setup") return setStep("source");
    if (step === "review") return setStep("setup");
    if (step === "distribute") return setStep("done");
  }

  async function chooseCategory(item: PublishCategoryInfo) {
    setError("");
    if (item.id === "live") {
      navigate("/live");
      return;
    }
    setCategory(item.id);
    setWriteup("");
    setScheduleMode("now");
    setAudience("FREE");
    setVisibility("public");
    setRights({ ...DEFAULT_PUBLISH_RIGHTS });
    setSetupPanel(null);
    clearSelection();
    setSource("drafts");
    setStep("source");
    void loadCandidates("drafts", item.id);
  }

  async function loadCandidates(nextSource: PublishSourceId, nextCategory = category) {
    if (!nextCategory || nextSource === "external") {
      setCandidates([]);
      setDriveFiles([]);
      return;
    }
    const seq = ++loadSeq.current;
    setBusy(true);
    setError("");
    try {
      if (nextSource === "drive") {
        const [drive, data] = await Promise.all([
          api<{ files: DriveFile[]; detail: string }>("/publish/drive"),
          api<{ candidates: PublishCandidate[] }>(`/publish/candidates?category=${nextCategory}&source=drive`),
        ]);
        if (seq !== loadSeq.current) return;
        setDriveFiles(drive.files);
        setCandidates(data.candidates);
      } else {
        const data = await api<{ candidates: PublishCandidate[] }>(
          `/publish/candidates?category=${nextCategory}&source=drafts`,
        );
        if (seq !== loadSeq.current) return;
        setCandidates(data.candidates);
        setDriveFiles([]);
      }
    } catch {
      if (seq !== loadSeq.current) return;
      setError(nextSource === "drive" ? "Unable to load Drive." : "Drafts unavailable.");
      setCandidates([]);
      setDriveFiles([]);
    } finally {
      if (seq === loadSeq.current) setBusy(false);
    }
  }

  function chooseSourceTab(id: PublishSourceId) {
    const info = sources.find((item) => item.id === id);
    if (info && !info.available) {
      setError(info.reason || "Unavailable");
      return;
    }
    setError("");
    if (id !== source) {
      clearSelection();
      setSource(id);
    } else {
      setSource(id);
    }
    if (id !== "external") void loadCandidates(id);
    else {
      setCandidates([]);
      setDriveFiles([]);
    }
  }

  function applyCandidate(item: PublishCandidate, nextPreview?: LocalMediaPreview | null) {
    const nextFormat = inferPublishFormat(item.assetType);
    setSelectedId(item.id);
    setSelected(item);
    setFormat(nextFormat);
    setPresentationTypes(nextFormat === "video" || item.assetType === "VIDEO" ? ["POST"] : []);
    setUploadState("ready");
    setUploadPercent(100);
    if (nextPreview) setPreview(nextPreview);
  }

  function chooseCandidate(item: PublishCandidate) {
    setError("");
    applyCandidate(item);
  }

  async function chooseDriveFile(file: DriveFile) {
    setBusy(true);
    setError("");
    try {
      const data = await api<{ candidate: PublishCandidate }>(`/publish/drive/${file.id}/select`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      applyCandidate(data.candidate);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to load Drive.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadExternalFile(file: File, existingPreview?: LocalMediaPreview) {
    pendingFile.current = file;
    const local = existingPreview ?? createLocalMediaPreview(file);
    if (!existingPreview) {
      revokeLocalMediaPreview(preview?.url);
      setPreview(local);
    }
    setSelected(null);
    setSelectedId(null);
    setFormat(inferPublishFormat("", file.type));
    setUploadState("uploading");
    setUploadPercent(null);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const data = await uploadForm<{
        assets?: ImportedAsset[];
        status?: string;
        jobId?: string;
      }>("/import/file", form, (percent) => setUploadPercent(percent));
      const asset = data.assets?.[0];
      if (asset) {
        applyCandidate(candidateFromImportedAsset(asset), local);
        return;
      }
      if (data.status === "QUEUED" && data.jobId) {
        setUploadState("processing");
        const ready = await waitForQueuedAsset(data.jobId);
        applyCandidate(candidateFromImportedAsset(ready), local);
        return;
      }
      throw new Error("Upload failed. Retry.");
    } catch (err) {
      setUploadState("failed");
      setSelected(null);
      setSelectedId(null);
      setError(err instanceof ApiError ? "Upload failed. Retry." : err instanceof Error ? err.message : "Upload failed. Retry.");
    }
  }

  async function waitForQueuedAsset(jobId: string): Promise<ImportedAsset> {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      const job = await api<{ status: string; assetIds: string[] }>(`/import-jobs/${jobId}`);
      if (job.status === "FAILED") throw new Error("Upload failed. Retry.");
      const assetId = job.assetIds?.[0];
      if (job.status === "COMPLETED" && assetId) {
        const data = await api<{ asset: ImportedAsset }>(`/assets/${assetId}`);
        return data.asset;
      }
    }
    throw new Error("Upload failed. Retry.");
  }

  function onExternalFile(file: File) {
    void uploadExternalFile(file);
  }

  async function publish() {
    if (!selected || !category || !canonicalReady) return;
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
          writeup,
          visibility,
          rights,
          scheduleMode,
          scheduledAt,
          contentFormat: format,
          category,
          ...(format === "video" || selected.assetType === "VIDEO"
            ? {
                presentationTypes,
                presentationType: presentationTypes[0] ?? null,
              }
            : {}),
          audience,
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
      : step === "source"
        ? "Content Source"
        : step === "setup"
          ? "Post"
          : step === "review"
            ? "Review"
            : step === "done"
              ? "Published!"
              : "Distribute";

  return (
    <section className="page publish-center" data-publish-step={step} data-publish-source={source} data-upload-state={uploadState}>
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

      {step === "source" ? (
        <div className="publish-source-screen">
          <div className="publish-source-body">
            {preview ? (
              <article className="publish-media-preview">
                {preview.kind === "image" ? (
                  <img src={preview.url} alt="" />
                ) : preview.kind === "video" ? (
                  <video src={preview.url} controls playsInline muted />
                ) : (
                  <p className="publish-filename">{preview.name}</p>
                )}
                {uploadState === "uploading" ? (
                  <p className="small muted publish-upload-status" aria-live="polite">
                    {uploadPercent == null ? "Uploading…" : `Uploading… ${uploadPercent}%`}
                  </p>
                ) : null}
                {uploadState === "processing" ? (
                  <p className="small muted publish-upload-status" aria-live="polite">
                    Processing…
                  </p>
                ) : null}
                {uploadState === "ready" ? (
                  <p className="small muted publish-upload-status">Ready</p>
                ) : null}
                {uploadState === "failed" ? (
                  <div className="publish-upload-fail">
                    <p className="small">Upload failed. Retry.</p>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        const file = pendingFile.current;
                        if (file) void uploadExternalFile(file, preview);
                      }}
                    >
                      Retry
                    </button>
                  </div>
                ) : null}
              </article>
            ) : null}

            {source === "external" && !preview ? (
              <div className="publish-choose-file">
                <input
                  id="publish-external-file"
                  className="sr-only"
                  type="file"
                  accept={category === "audio" ? "audio/*" : "image/*,video/*"}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onExternalFile(file);
                    e.currentTarget.value = "";
                  }}
                />
                <label htmlFor="publish-external-file" className="btn publish-choose-file-btn">
                  Choose File
                </label>
              </div>
            ) : null}

            {source === "external" && preview ? (
              <div className="publish-choose-file">
                <input
                  id="publish-external-file-again"
                  className="sr-only"
                  type="file"
                  accept={category === "audio" ? "audio/*" : "image/*,video/*"}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) onExternalFile(file);
                    e.currentTarget.value = "";
                  }}
                />
                <label htmlFor="publish-external-file-again" className="btn ghost">
                  Choose File
                </label>
              </div>
            ) : null}

            {source === "drafts" ? (
              <>
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
                        {ASSET_TYPE_LABELS[item.assetType]} · {new Date(item.updatedAt).toLocaleDateString()}
                      </span>
                    </span>
                    <span className="publish-chevron">›</span>
                  </button>
                ))}
                {!busy && !candidates.length ? <p className="muted">No drafts.</p> : null}
              </>
            ) : null}

            {source === "drive" ? (
              <>
                {driveFiles.map((file) => (
                  <button key={file.id} type="button" className="publish-row" onClick={() => void chooseDriveFile(file)}>
                    <span>
                      <strong className="publish-filename">{file.filename}</strong>
                      <span className="small muted">
                        {file.mimeType} · {Math.max(1, Math.round(file.sizeBytes / 1024))} KB
                      </span>
                    </span>
                    <span className="publish-chevron">›</span>
                  </button>
                ))}
                {candidates.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`publish-row${selectedId === item.id ? " selected" : ""}`}
                    onClick={() => chooseCandidate(item)}
                  >
                    <span>
                      <strong>{item.title}</strong>
                      <span className="small muted">{ASSET_TYPE_LABELS[item.assetType]}</span>
                    </span>
                    <span className="publish-chevron">›</span>
                  </button>
                ))}
                {!busy && !driveFiles.length && !candidates.length ? <p className="muted">No Drive content.</p> : null}
              </>
            ) : null}

            {busy && source !== "external" ? <p className="small muted">Loading…</p> : null}
          </div>

          <div className="publish-source-foot">
            <button
              type="button"
              className="btn"
              disabled={!canonicalReady}
              onClick={() => {
                setError("");
                setStep("setup");
              }}
            >
              Next
            </button>
            <div className="publish-source-tabs" role="tablist" aria-label="Content source">
              {SOURCE_TAB_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={source === id}
                  className={source === id ? "active" : ""}
                  onClick={() => chooseSourceTab(id)}
                >
                  {SOURCE_TAB_LABELS[id]}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {step === "setup" && selected ? (
        <div className="publish-setup">
          <article className="publish-media-preview">
            {preview?.kind === "image" ? (
              <img src={preview.url} alt="" />
            ) : preview?.kind === "video" ? (
              <video src={preview.url} controls playsInline muted />
            ) : (
              <p className="small muted">{ASSET_TYPE_LABELS[selected.assetType]}</p>
            )}
          </article>
          <label className="field publish-writeup">
            Post write-up
            <textarea
              rows={6}
              value={writeup}
              maxLength={WRITEUP_MAX_CHARS}
              onChange={(e) => setWriteup(e.target.value)}
              placeholder="Say something about this..."
            />
            <span className="small muted">
              {writeup.length}/{WRITEUP_MAX_CHARS}
            </span>
          </label>

          <button type="button" className="publish-config-row" onClick={() => setSetupPanel(setupPanel === "schedule" ? null : "schedule")}>
            <span>Schedule</span>
            <strong>
              {scheduleLabel} <span aria-hidden>›</span>
            </strong>
          </button>
          {setupPanel === "schedule" ? (
            <div className="publish-config-panel">
              <label className={`publish-radio${scheduleMode === "now" ? " on" : ""}`}>
                <input type="radio" name="schedule" checked={scheduleMode === "now"} onChange={() => setScheduleMode("now")} />
                <span>
                  <strong>Now</strong>
                  <span className="small muted">Publish immediately.</span>
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
                  <span className="small muted">Choose a future date and time.</span>
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
                  <p className="small muted">Timezone: {timezone}</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <button type="button" className="publish-config-row" onClick={() => setSetupPanel(setupPanel === "audience" ? null : "audience")}>
            <span>Audience</span>
            <strong>
              {PUBLISH_AUDIENCE_LABELS[audience]} <span aria-hidden>›</span>
            </strong>
          </button>
          {setupPanel === "audience" ? (
            <div className="publish-config-panel">
              {PUBLISH_AUDIENCES.map((id) => (
                <label key={id} className={`publish-radio${audience === id ? " on" : ""}`}>
                  <input type="radio" name="audience" checked={audience === id} onChange={() => setAudience(id)} />
                  <span>
                    <strong>{PUBLISH_AUDIENCE_LABELS[id]}</strong>
                    <span className="small muted">{PUBLISH_AUDIENCE_DETAILS[id]}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          <button type="button" className="publish-config-row" onClick={() => setSetupPanel(setupPanel === "visibility" ? null : "visibility")}>
            <span>Visibility</span>
            <strong>
              {PUBLISH_VISIBILITY_LABELS[visibility]} <span aria-hidden>›</span>
            </strong>
          </button>
          {setupPanel === "visibility" ? (
            <div className="publish-config-panel">
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
            </div>
          ) : null}

          <button type="button" className="publish-config-row" onClick={() => setSetupPanel(setupPanel === "rights" ? null : "rights")}>
            <span>Usage Rights</span>
            <strong>
              {usageRightsLabel(rights)} <span aria-hidden>›</span>
            </strong>
          </button>
          {setupPanel === "rights" ? (
            <div className="publish-config-panel">
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
            </div>
          ) : null}

          <button
            className="btn"
            disabled={!scheduleReady || !canonicalReady}
            onClick={() => {
              setError("");
              setStep("review");
            }}
          >
            Review
          </button>
        </div>
      ) : null}

      {step === "review" && selected ? (
        <div className="publish-review">
          <article className="publish-media-preview">
            {preview?.kind === "image" ? (
              <img src={preview.url} alt="" />
            ) : preview?.kind === "video" ? (
              <video src={preview.url} controls playsInline muted />
            ) : (
              <p className="small muted">{ASSET_TYPE_LABELS[selected.assetType]}</p>
            )}
          </article>
          <article className="panel">
            <div className="eyebrow">Post write-up</div>
            <p className="muted publish-review-writeup">{writeup || "No write-up"}</p>
            <dl className="publish-summary">
              <div>
                <dt>Schedule</dt>
                <dd>{scheduleMode === "now" ? "Now" : `${scheduledDate} ${scheduledTime} (${timezone})`}</dd>
              </div>
              <div>
                <dt>Audience</dt>
                <dd>{PUBLISH_AUDIENCE_LABELS[audience]}</dd>
              </div>
              <div>
                <dt>Visibility</dt>
                <dd>{PUBLISH_VISIBILITY_LABELS[visibility]}</dd>
              </div>
              <div>
                <dt>Usage Rights</dt>
                <dd>{usageRightsLabel(rights)}</dd>
              </div>
            </dl>
          </article>
          <button className="btn" disabled={busy || !canonicalReady} onClick={() => void publish()}>
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
              View Published Post
            </Link>
          ) : null}
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
