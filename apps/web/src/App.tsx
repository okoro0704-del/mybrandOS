import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { brandSlugFromHost } from "@mybrandos/shared";
import { OsShell } from "./components/OsShell";
import { RequireAuth } from "./components/RequireAuth";
import { AssetDetailPage } from "./pages/AssetDetail";
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
import { ImportPage } from "./pages/Import";
import { SearchPage } from "./pages/Search";
import { PersonalSpacePage } from "./pages/PersonalSpace";
import { ProjectsPage } from "./pages/Projects";
import { ActivityPage } from "./pages/Activity";
import { BrandPage } from "./pages/Brand";
import { WebsitePage } from "./pages/Website";
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

function BrandAdminEnter({ slug }: { slug: string }) {
  const trustId = `TD-WL-${slug.toUpperCase().replace(/-/g, "")}`.slice(0, 80);
  const to = `/enter?wl=1&trustId=${encodeURIComponent(trustId)}&name=${encodeURIComponent(slug)}`;
  return <Navigate to={to} replace />;
}

function BrandHostPublic() {
  const { "*": rest } = useParams();
  const slug = brandSlugFromHost(window.location.hostname);
  if (!slug) return <Navigate to="/" replace />;
  return <PublicExperiencePage slugOverride={slug} restOverride={rest} />;
}

function WorkstationRoutes() {
  return (
    <Routes>
      <Route path="/enter" element={<EnterPage />} />
      <Route path="/auth/callback" element={<CallbackPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<OsShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/create" element={<CreatePage />} />
          <Route path="/create/:id" element={<CreateProjectPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/assets" element={<AssetsPage />} />
          <Route path="/assets/:id" element={<AssetDetailPage />} />
          <Route path="/audience" element={<AudiencePage />} />
          <Route path="/commerce" element={<CommercePage />} />
          <Route path="/personal-space" element={<PersonalSpacePage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/live" element={<LiveCenterPage />} />
          <Route path="/recording" element={<RecordingListPage />} />
          <Route path="/recording/:id" element={<RecordingStudioPage />} />
          <Route path="/production" element={<ProductionListPage />} />
          <Route path="/production/:id" element={<ProductionStudioPage />} />
          <Route path="/processing" element={<ProcessingPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/brand" element={<BrandPage />} />
          <Route path="/website" element={<WebsitePage />} />
          <Route path="/command-center" element={<CommandCenterPage />} />
          <Route path="/collaboration" element={<CollaborationPage />} />
          <Route path="/elfcom" element={<ElfComPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/money" element={<MoneyPage />} />
          <Route path="/publish" element={<PublishCenterPage />} />
          <Route path="/publish/*" element={<PublishCenterPage />} />
          <Route path="/distribution" element={<DistributionPage />} />
          <Route path="/ai" element={<AiPage />} />
          <Route path="/system" element={<SettingsPage />} />
          <Route path="/system/camera" element={<CameraCapabilityPage />} />
          <Route path="/settings" element={<Navigate to="/system" replace />} />
        </Route>
        <Route path="/brand/preview" element={<BrandPreviewPage />} />
        <Route path="/brand/preview/*" element={<BrandPreviewPage />} />
        <Route path="/production/join/:code" element={<ProductionJoinPage />} />
        <Route path="/preview/:code" element={<PreviewJoinPage />} />
      </Route>
      <Route path="/u/:slug" element={<PublicExperiencePage />} />
      <Route path="/u/:slug/*" element={<PublicExperiencePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/**
 * On `{slug}.getlifeos.app` the public Digital Life is the product at `/`.
 * Workstation stays on the Railway origin (or /enter on this host for admin).
 */
export function App() {
  const brandSlug = brandSlugFromHost(typeof window !== "undefined" ? window.location.hostname : null);
  if (brandSlug) {
    return (
      <Routes>
        <Route path="/enter" element={<EnterPage />} />
        <Route path="/auth/callback" element={<CallbackPage />} />
        <Route path="/admin" element={<BrandAdminEnter slug={brandSlug} />} />
        <Route path="/admin/*" element={<BrandAdminEnter slug={brandSlug} />} />
        <Route path="/u/:slug" element={<PublicExperiencePage />} />
        <Route path="/u/:slug/*" element={<PublicExperiencePage />} />
        <Route path="/" element={<PublicExperiencePage slugOverride={brandSlug} restOverride="" />} />
        <Route path="/*" element={<BrandHostPublic />} />
      </Routes>
    );
  }
  return <WorkstationRoutes />;
}
