import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { LIFEOS_PRIMITIVE_IDS } from "@mybrandos/shared";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

const SCAN_ROOTS = [
  join(repoRoot, "apps", "api", "src"),
  join(repoRoot, "apps", "web", "src"),
  join(repoRoot, "packages", "integrations", "src"),
  join(repoRoot, "packages", "shared", "src"),
];

const PACKAGE_JSONS = [
  join(repoRoot, "package.json"),
  join(repoRoot, "apps", "api", "package.json"),
  join(repoRoot, "packages", "integrations", "package.json"),
];

const FORBIDDEN = [
  { id: "bullmq", re: /from\s+["']bullmq["']|require\(["']bullmq["']\)/ },
  { id: "bee-queue", re: /from\s+["']bee-queue["']|require\(["']bee-queue["']\)/ },
  { id: "ioredis", re: /from\s+["']ioredis["']|require\(["']ioredis["']\)/ },
  { id: "redis-client", re: /from\s+["']redis["']|createClient\(\s*\{[^}]*redis/i },
  { id: "websocket-server", re: /from\s+["']ws["']|new\s+WebSocketServer\b/ },
  { id: "socket-io-server", re: /from\s+["']socket\.io["']|new\s+Server\([^;]*socket/ },
  { id: "s3-blob-engine", re: /from\s+["']@aws-sdk\/client-s3["']|from\s+["']minio["']/ },
  { id: "biometric-idp", re: /from\s+["']@simplewebauthn\/server["']|class\s+BiometricIdentity/ },
  { id: "wallet-ledger", re: /class\s+(WalletLedger|DoubleEntryLedger|LocalWalletEngine|PaymentPrimitive|WalletPrimitive|CheckoutPrimitive|BillingPrimitive|MarketplaceEngine)\b/ },
  { id: "fake-fundzman", re: /class\s+(FakeFundzManAdapter|LocalPaymentEngine|BrowserPaidCheckout)\b/ },
  { id: "local-queue", re: /class\s+(LocalQueue|InMemoryQueue|BullWorker|JobWorker|LocalRenderQueue|InMemoryRenderQueue)\b/ },
  { id: "fake-engines", re: /class\s+(LiveEngine|StreamingEngine|BroadcastEngine|DistributionEngine|SocialEngine|RenderEngine|NotificationEngine|AnalyticsEngine|SearchEngine|InProcessMediaServer|FakeStreamingServer|LocalLiveEngine|LocalAudioEngine|LocalVideoEngine|LocalCodeExecutionEngine|OBSEngine|BroadcastSuite|FakeDeviceBridge|LocalStreamingBackend|ProductionPrimitive|DevicePrimitive|StreamingPrimitive|RecordingPrimitive|CameraPrimitive|AudioPrimitive|PreviewPrimitive|MediaPrimitive|RecordingService|CameraService|AudioService|StreamingService|PreviewService|PublicFeedBackend|WebsiteCMSBackend|CreatorSocialBackend|NewsBackend|PWADataBackend|OfflineCMS|PublicCheckoutBackend|StoreBackend|ConsumerContentDB|PublicContentDB|PublicSocialBackend|UniversalSocialGraph|TrendingEngine|RecommendationBackend|FavoriteContentDB|CreatorFeedEngine)\b/ },
  { id: "duplicate-cms", re: /model\s+(BrandAsset|BrandContent|PublicContent|CourseAsset|BookAsset|VideoAsset|VideoContent|MediaAsset|HighlightAsset|MusicCMS|WritingCMS|SoftwareCMS|MusicAsset|WritingAsset|SoftwareAsset|CameraAsset|DeviceAsset|RecordingAsset|ProgramAsset|PodcastAsset|WebsiteAsset|PublicAsset|PublicContentDB|DigitalLifeAsset|AppAsset|ConsumerContentDB)\b/ },
  { id: "duplicate-app-types", re: /class\s+(DigitalLifeAsset|AppAsset|PublicAsset|VideoAsset|MusicAsset|BookAsset|NewAssetType|NewPrimitive|SecondAuthenticationSystem|SecondSearchBackend|SecondCommerceBackend)\b/ },
  { id: "duplicate-destination-assets", re: /\b(FacebookReplayAsset|InstagramReplayAsset|YouTubeVideoAsset|YouTubeShortAsset|YouTubeReplayAsset)\b/ },
  { id: "external-source-of-truth", re: /class\s+(GitHubSourceOfTruth|NetlifySourceOfTruth)\b/ },
  { id: "credential-sharing", re: /class\s+(SharedOwnerCredentials|CredentialRelay)\b/ },
  { id: "search-infra", re: /from\s+["']elasticsearch["']|from\s+["']@elastic\/elasticsearch["']|from\s+["']meilisearch["']/ },
];

const FORBIDDEN_DEPS = [
  "bullmq",
  "bee-queue",
  "ioredis",
  "redis",
  "minio",
  "@aws-sdk/client-s3",
  "ws",
  "socket.io",
  "@simplewebauthn/server",
  "elasticsearch",
  "@elastic/elasticsearch",
  "meilisearch",
];

function walk(dir: string, files: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (extname(full) === ".ts" || extname(full) === ".tsx" || extname(full) === ".prisma") files.push(full);
  }
  return files;
}

test("mybrandOS does not recreate primitive infrastructure", () => {
  const hits: string[] = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walk(root)) {
      const source = readFileSync(file, "utf8");
      for (const rule of FORBIDDEN) {
        if (rule.re.test(source)) hits.push(`${rule.id}: ${file}`);
      }
    }
  }
  const schema = readFileSync(join(repoRoot, "apps", "api", "prisma", "schema.prisma"), "utf8");
  for (const rule of FORBIDDEN.filter((item) => item.id === "duplicate-cms")) {
    if (rule.re.test(schema)) hits.push(`${rule.id}: schema.prisma`);
  }
  assert.deepEqual(hits, []);
});

test("package manifests do not own queue, blob, or messaging infrastructure", () => {
  const hits: string[] = [];
  for (const file of PACKAGE_JSONS) {
    const pkg = JSON.parse(readFileSync(file, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of FORBIDDEN_DEPS) {
      if (name in deps) hits.push(`${name}: ${file}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("exactly six canonical primitives — AI is a provider", () => {
  assert.equal(LIFEOS_PRIMITIVE_IDS.length, 6);
  assert.equal((LIFEOS_PRIMITIVE_IDS as readonly string[]).includes("ai"), false);
  assert.equal((LIFEOS_PRIMITIVE_IDS as readonly string[]).includes("identity"), false);
  assert.equal((LIFEOS_PRIMITIVE_IDS as readonly string[]).includes("distribution-hub"), false);
  assert.deepEqual([...LIFEOS_PRIMITIVE_IDS], [
    "trust-id",
    "elfcom",
    "sovereign-drive",
    "platform-jobs",
    "master-distributor",
    "fundzman",
  ]);
});
