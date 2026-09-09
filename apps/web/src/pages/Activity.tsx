import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ActivityItem } from "@mybrandos/shared";
import { api } from "../lib/api";

export function ActivityPage() {
  const [activity, setActivity] = useState<ActivityItem[] | null>(null);

  useEffect(() => {
    void api<{ activity: ActivityItem[] }>("/activity").then((data) => setActivity(data.activity));
  }, []);

  if (!activity) {
    return <section className="page"><p className="muted">Loading activity…</p></section>;
  }

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Activity</div>
        <h1>What happened</h1>
        <p>Creates, imports, versions, publishes, and distribution — from your Digital Life records.</p>
      </header>
      {activity.length === 0 ? (
        <article className="panel">
          <p className="muted">No activity yet. Create, import, or publish an asset.</p>
        </article>
      ) : (
        <article className="panel">
          {activity.map((item) => (
            <div className="list-row" key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <div className="small muted">{item.detail}</div>
                <div className="small faint">{new Date(item.createdAt).toLocaleString()}</div>
              </div>
              {item.assetId ? <Link to={`/assets/${item.assetId}`}>Asset</Link> : <span className="chip">{item.kind}</span>}
            </div>
          ))}
        </article>
      )}
    </section>
  );
}
