import { AppLink as Link } from "../lib/paths";

export function StudioHomePage() {
  return <section className="page" data-testid="studio-home">
    <header className="page-head"><div className="eyebrow">Studio</div><h1>Create. Produce. Broadcast.</h1><p>One creator workspace for the work you publish and the programming you operate.</p></header>
    <div className="launch-grid">
      <Link className="launch" to="/create" data-testid="creator-studio"><b>Creator Studio</b><span className="small muted">Create posts, books, courses, video, music, writing, and software using your canonical project and media records.</span></Link>
      <Link className="launch" to="/production" data-testid="production-studio"><b>Production Studio</b><span className="small muted">Operate production sessions. TV programming uses the canonical broadcast schedule; Radio remains prepared through the shared station model.</span></Link>
    </div>
    <article className="panel" style={{ marginTop: 16 }}><div className="eyebrow">Production library</div><p>Production uses canonical asset identities and adds programming/provenance relationships. Direct production media, rights records, TV schedule publishing, and Space sync require their existing backend boundaries before they can report success.</p></article>
  </section>;
}
