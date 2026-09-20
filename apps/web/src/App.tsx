import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { resolveDigitalLifeRequest, studioPath } from "@mybrandos/shared";
import { OsShell } from "./components/OsShell";
import { RequireAuth } from "./components/RequireAuth";
import { AssetDetailPage } from "./pages/AssetDetail";
import { AssetsGalaxyPage } from "./pages/AssetsGalaxy";
import { AssetsPage } from "./pages/Assets";
import { AudiencePage } from "./pages/Audience";
import { CallbackPage } from "./pages/Callback";
import { CollaborationPage } from "./pages/Collaboration";
import { CommandCenterPage } from "./pages/CommandCenter";
import { CommercePage } from "./pages/Commerce";
import { CreatePage } from "./pages/Create";
import { CreateProjectPage } from "./pages/CreateProject";
import { EnterPage } from "./pages/Enter";
import { HomePage } from "./pages/Home";
import { DigiTwinPage } from "./pages/DigiTwin";
import { ImportPage } from "./pages/Import";
import { SearchPage } from "./pages/Search";
import { PersonalSpacePage } from "./pages/PersonalSpace";
import { ProjectsPage } from "./pages/Projects";
import { ActivityPage } from "./pages/Activity";
import { BrandPage } from "./pages/Brand";
import { WebsitePage } from "./pages/Website";
import { InfoAdminPage } from "./pages/InfoAdmin";
import { BrandPreviewPage, PublicExperiencePage } from "./pages/PublicExperience";
import { LiveCenterPage } from "./pages/LiveCenter";
import { ProductionJoinPage } from "./pages/ProductionJoin";
import { ProductionListPage, ProductionStudioPage } from "./pages/Production";
import { PreviewJoinPage, RecordingListPage, RecordingStudioPage } from "./pages/Recording";
import { ProcessingPage } from "./pages/Processing";
import { PublishCenterPage } from "./pages/PublishCenter";
import { CameraCapabilityPage } from "./pages/CameraCapability";
import {
  AiPage,
  AnalyticsPage,
  DistributionPage,
  ElfComPage,
  MoneyPage,
  SettingsPage,
} from "./pages/SystemPages";

function WorkstationRoutes() {
  const s = (path: string) => studioPath(path, window.location.hostname);
  return (
    <Routes>
      <Route path="/enter" element={<EnterPage />} />
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route path="/studio/*" element={<section className="gate"><h1>Studio has moved</h1><Link to={s("/")}>Open Creator Dashboard</Link></section>} />
      <Route element={<RequireAuth />}>
        <Route element={<OsShell />}>
          <Route path={s("/")} element={<HomePage />} />
          <Route path={s("/twin")} element={<DigiTwinPage />} />
          <Route path={s("/create")} element={<CreatePage />} />
          <Route path={s("/create/:id")} element={<CreateProjectPage />} />
          <Route path={s("/camera")} element={<CameraCapabilityPage />} />
          <Route path={s("/system/camera")} element={<Navigate to={s("/camera")} replace />} />
          <Route path={s("/import")} element={<ImportPage />} />
          <Route path={s("/search")} element={<SearchPage />} />
          <Route path={s("/assets")} element={<AssetsPage />} />
          <Route path={s("/assets/galaxy")} element={<AssetsGalaxyPage />} />
          <Route path={s("/assets/:id")} element={<AssetDetailPage />} />
          <Route path={s("/audience")} element={<AudiencePage />} />
          <Route path={s("/commerce")} element={<CommercePage />} />
          <Route path={s("/personal-space")} element={<PersonalSpacePage />} />
          <Route path={s("/projects")} element={<ProjectsPage />} />
          <Route path={s("/live")} element={<LiveCenterPage />} />
          <Route path={s("/recording")} element={<RecordingListPage />} />
          <Route path={s("/recording/:id")} element={<RecordingStudioPage />} />
          <Route path={s("/production")} element={<ProductionListPage />} />
          <Route path={s("/production/:id")} element={<ProductionStudioPage />} />
          <Route path={s("/processing")} element={<ProcessingPage />} />
          <Route path={s("/activity")} element={<ActivityPage />} />
          <Route path={s("/brand")} element={<BrandPage />} />
          <Route path={s("/website")} element={<WebsitePage />} />
          <Route path={s("/info")} element={<InfoAdminPage />} />
          <Route path={s("/info/*")} element={<InfoAdminPage />} />
          <Route path={s("/command-center")} element={<CommandCenterPage />} />
          <Route path={s("/collaboration")} element={<CollaborationPage />} />
          <Route path={s("/elfcom")} element={<ElfComPage />} />
          <Route path={s("/analytics")} element={<AnalyticsPage />} />
          <Route path={s("/money")} element={<MoneyPage />} />
          <Route path={s("/publish")} element={<PublishCenterPage />} />
          <Route path={s("/publish/*")} element={<PublishCenterPage />} />
          <Route path={s("/distribution")} element={<DistributionPage />} />
          <Route path={s("/ai")} element={<AiPage />} />
          <Route path={s("/system")} element={<SettingsPage />} />
          <Route path={s("/settings")} element={<Navigate to={s("/system")} replace />} />
          <Route path={s("/*")} element={<section className="page"><h1>Studio page not found</h1></section>} />
        </Route>
        <Route path={s("/brand/preview")} element={<BrandPreviewPage />} />
        <Route path={s("/brand/preview/*")} element={<BrandPreviewPage />} />
        <Route path="/production/join/:code" element={<ProductionJoinPage />} />
        <Route path="/preview/:code" element={<PreviewJoinPage />} />
      </Route>
    </Routes>
  );
}


export function App() {
  const location = useLocation();
  const context = resolveDigitalLifeRequest(window.location.hostname, location.pathname);
  if (context.surface !== "workstation" && context.slug) {
    return <PublicExperiencePage key={context.slug} slugOverride={context.slug} restOverride={context.rest} />;
  }
  if (context.surface !== "workstation") {
    return <main className="gate" data-surface="website"><div className="gate-card">
      <div className="gate-mark">m</div><h1>{location.pathname === "/" ? "mybrandOS" : "Page not found"}</h1>
      <p>Create and publish your Digital Life. Visit a creator’s app using their public link.</p>
      <Link className="btn" to={studioPath("/", window.location.hostname)}>Open Creator Dashboard</Link>
    </div></main>;
  }
  return <WorkstationRoutes />;
}
