import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  STATION_DEFAULT_ITEM_MS,
  type LiveCapability,
  type PublicStationResume,
  type StationChannel,
  type StationLiveState,
  type StationMediaItem,
  type StationNow,
  type StationProgramming,
  type StationResumePolicy,
  type StationScheduleDraft,
  type UnifiedLiveSession,
} from "@mybrandos/shared";
import { ApiError, api } from "../lib/api";
import { AppLink as Link } from "../lib/paths";
import { GoLivePanel, RESUME_POLICY_COPY } from "./GoLivePanel";

type StationState = {
  channel: StationChannel;
  capability: LiveCapability;
  programming: StationProgramming;
  now: StationNow;
  next: StationMediaItem | null;
  state: StationLiveState;
  active: UnifiedLiveSession | null;
  activeDetail: string | null;
  lastResume: (PublicStationResume & { appliedPolicy?: StationResumePolicy; requestedPolicy?: StationResumePolicy; fallbackReason?: string | null; programTitle?: string | null }) | null;
  defaultResumePolicy: StationResumePolicy;
};

type Tab = "control" | "schedule" | "programs" | "golive";

const STATE_LABEL: Record<StationLiveState, string> = {
  SCHEDULE_PLAYING: "Schedule playing",
  PRE_LIVE: "Pre-live",
  LIVE_STARTING: "Live starting",
  LIVE: "LIVE — schedule suspended",
  END_LIVE: "Ending live",
  RESUME_POLICY: "Resuming schedule",
};

function minuteLabel(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

function parseMinute(value: string) {
  const [h, m] = value.split(":").map(Number);
  return Math.max(0, Math.min(1439, (h || 0) * 60 + (m || 0)));
}

function draftsFrom(programming: StationProgramming): StationScheduleDraft[] {
  return programming.schedule.map((block) => ({
    id: block.id,
    title: block.title,
    startMinute: block.startMinute,
    durationMs: Number.isFinite(block.item.durationMs) ? block.item.durationMs : STATION_DEFAULT_ITEM_MS,
    assetId: block.item.assetId,
    kind: block.item.kind,
    sponsored: block.item.sponsored,
  }));
}

export function StationProductionStudio({ channel }: { channel: StationChannel }) {
  const slug = channel === "TV" ? "tv" : "radio";
  const label = channel === "TV" ? "TV" : "Radio";
  const [state, setState] = useState<StationState | null>(null);
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => {
    const requested = params.get("tab");
    return requested === "schedule" || requested === "programs" || requested === "golive" ? requested : "control";
  });
  const [goLiveOpened, setGoLiveOpened] = useState(false);
  useEffect(() => {
    if (tab === "golive") setGoLiveOpened(true);
  }, [tab]);
  const [drafts, setDrafts] = useState<StationScheduleDraft[]>([]);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api<StationState>(`/production/stations/${slug}`);
      setState(data);
      setError("");
      if (!dirty) setDrafts(draftsFrom(data.programming));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `${label} Production Studio could not be loaded. Check your connection.`);
    }
  }, [slug, label, dirty]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const onSessionChange = useCallback(
    (session: UnifiedLiveSession | null) => {
      if (session) void load();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function saveSchedule() {
    setMessage("");
    try {
      await api(`/production/stations/${slug}/schedule`, {
        method: "PUT",
        body: JSON.stringify({ schedule: drafts.map((row, i) => ({ ...row, id: row.id || `${slug}-${Date.now()}-${i}` })) }),
      });
      setDirty(false);
      setMessage("Schedule saved. Viewers pick it up on their next refresh.");
      await load();
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : "The schedule could not be saved.");
    }
  }

  function editDraft(index: number, patch: Partial<StationScheduleDraft>) {
    setDirty(true);
    setDrafts((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const programs = state?.programming.fallback.items ?? [];
  const live = state?.state === "LIVE";

  return (
    <section className={`page station-studio station-studio--${slug}`} data-station-studio={channel} data-station-state={state?.state ?? "LOADING"}>
      <header className="page-head station-studio__head">
        <div className="eyebrow"><Link to="/production">Production Studio</Link> · {label}</div>
        <h1>{label} Production Studio</h1>
        {state ? <span className={`station-studio__state${live ? " is-live" : ""}`}>{STATE_LABEL[state.state]}</span> : null}
      </header>
      {error ? <p className="placeholder-note" role="alert">{error}</p> : null}

      {state ? (
        <div className={`station-console${channel === "RADIO" ? " station-console--radio" : ""}`}>
          <div className="station-console__monitor">
            <div className="station-console__screen" data-reason={state.now.reason}>
              {state.now.reason === "live-override" ? <span className="station-console__live">LIVE</span> : null}
              <strong>{state.now.item?.title ?? state.now.emptyMessage}</strong>
              <small>
                {state.now.reason === "live-override"
                  ? "On air. The schedule is suspended and preserved."
                  : state.now.reason === "ad"
                    ? "Sponsored slot"
                    : state.now.reason === "scheduled"
                      ? "Scheduled program"
                      : state.now.reason === "fallback-playlist"
                        ? "Station playlist"
                        : ""}
              </small>
            </div>
            <div className="station-console__next">
              <span>Next</span>
              <strong>{state.next?.title ?? "Continues with the station playlist"}</strong>
            </div>
          </div>

          <nav className="station-console__tabs" role="tablist">
            {(["control", "schedule", "programs", "golive"] as const).map((id) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "is-active" : ""} onClick={() => setTab(id)}>
                {id === "control" ? "Control" : id === "schedule" ? "Schedule" : id === "programs" ? "Programs & Playlist" : "Go Live"}
              </button>
            ))}
          </nav>

          {tab === "control" ? (
            <div className="station-console__panel">
              <dl className="station-console__facts">
                <div><dt>Channel</dt><dd>{state.programming.identity.stationId} · {label}</dd></div>
                <div><dt>State</dt><dd>{STATE_LABEL[state.state]}</dd></div>
                <div><dt>Live provider</dt><dd>{state.capability.available ? "Configured" : "Not configured — Go Live is unavailable"}</dd></div>
                <div><dt>Default after live</dt><dd>{RESUME_POLICY_COPY[state.defaultResumePolicy]}</dd></div>
              </dl>
              {state.active?.interruptionContext ? (
                <div className="station-console__interruption">
                  <h3>Interrupted program (preserved)</h3>
                  <p>
                    {state.active.interruptionContext.title ?? "Nothing scheduled"} at {Math.round(state.active.interruptionContext.offsetMs / 1000)}s ·
                    interrupted {new Date(state.active.interruptionContext.interruptedAt).toLocaleTimeString()} · resume policy {state.active.interruptionContext.resumePolicy}
                  </p>
                </div>
              ) : null}
              {state.lastResume ? (
                <div className="station-console__interruption">
                  <h3>Last live → schedule resume</h3>
                  <p>
                    {state.lastResume.appliedPolicy ?? state.lastResume.policy}
                    {state.lastResume.fallbackReason ? ` (requested ${state.lastResume.requestedPolicy}; ${state.lastResume.fallbackReason.replace(/_/g, " ")})` : ""}
                    {state.lastResume.programTitle ? ` → ${state.lastResume.programTitle}` : ""} at {new Date(state.lastResume.resumedAt).toLocaleTimeString()}
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "schedule" ? (
            <div className="station-console__panel">
              <p className="small muted">Times are local to the viewer’s clock. Live interrupts this schedule without changing it.</p>
              {drafts.length === 0 ? <p className="muted">No scheduled programs. Viewers see the station playlist.</p> : null}
              {drafts.map((row, i) => (
                <div className="station-slot" key={row.id || i}>
                  <input type="time" aria-label="Start time" value={minuteLabel(row.startMinute)} onChange={(e) => editDraft(i, { startMinute: parseMinute(e.target.value) })} />
                  <input aria-label="Program title" value={row.title} maxLength={200} onChange={(e) => editDraft(i, { title: e.target.value })} />
                  <select aria-label="Program" value={row.assetId ?? ""} onChange={(e) => {
                    const item = programs.find((p) => p.assetId === e.target.value);
                    editDraft(i, { assetId: e.target.value || null, title: row.title || item?.title || "Program", durationMs: item?.durationMs ?? row.durationMs });
                  }}>
                    <option value="">No media</option>
                    {programs.map((p) => <option key={p.id} value={p.assetId ?? ""}>{p.title}</option>)}
                  </select>
                  <label className="station-slot__min">
                    <input type="number" min={1} max={1440} aria-label="Duration in minutes" value={Math.round((row.durationMs || STATION_DEFAULT_ITEM_MS) / 60000)} onChange={(e) => editDraft(i, { durationMs: Math.max(1, Number(e.target.value) || 1) * 60000 })} /> min
                  </label>
                  <label className="cam-check"><input type="checkbox" checked={Boolean(row.sponsored)} onChange={(e) => editDraft(i, { sponsored: e.target.checked, kind: e.target.checked ? "ADVERTISEMENT" : "RECORDED_CONTENT" })} /> Ad</label>
                  <button type="button" className="btn ghost" onClick={() => { setDirty(true); setDrafts((rows) => rows.filter((_, j) => j !== i)); }}>Remove</button>
                </div>
              ))}
              <div className="actions">
                <button type="button" className="btn ghost" onClick={() => { setDirty(true); setDrafts((rows) => [...rows, { title: "New program", startMinute: Math.min(1439, (rows.at(-1)?.startMinute ?? 480) + 60), durationMs: STATION_DEFAULT_ITEM_MS, assetId: null }]); }}>Add program</button>
                <button type="button" className="btn" disabled={!dirty} onClick={() => void saveSchedule()}>Save schedule</button>
              </div>
              {message ? <p className="small" role="status">{message}</p> : null}
            </div>
          ) : null}

          {tab === "programs" ? (
            <div className="station-console__panel">
              <p className="small muted">
                The station playlist is every published work with the {label} surface. Publish with the {label} surface in Publish Center to add programs.
              </p>
              {programs.length === 0 ? <p className="muted">No {label}-eligible published works yet.</p> : null}
              <ol className="station-playlist">
                {programs.map((item) => (
                  <li key={item.id} className={state.now.item?.id === item.id ? "is-current" : ""}>
                    <strong>{item.title}</strong>
                    <small>{Math.round(item.durationMs / 60000)} min · {item.kind.replace(/_/g, " ").toLowerCase()}</small>
                  </li>
                ))}
              </ol>
              <Link className="btn ghost" to="/publish">Open Publish Center</Link>
            </div>
          ) : null}

          {/* Stays mounted once opened so the live heartbeat continues while other tabs are used. */}
          {goLiveOpened || (state.active && state.active.status !== "PREPARING") ? (
            <div className="station-console__panel" hidden={tab !== "golive"}>
              <GoLivePanel kind={channel} defaultTitle={`${label} live`} onSessionChange={onSessionChange} />
            </div>
          ) : null}
        </div>
      ) : !error ? (
        <p className="muted">Opening {label} Production Studio…</p>
      ) : null}
    </section>
  );
}
