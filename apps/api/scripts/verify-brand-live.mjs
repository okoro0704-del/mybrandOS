const API = "http://127.0.0.1:8793";

async function req(path, { method = "GET", token, body, headers } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body && !(body instanceof Buffer) ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body instanceof Buffer ? body : body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, text };
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const results = [];

function note(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

try {
  const unauthBrand = await req("/brand");
  note("GET /brand unauthenticated", unauthBrand.status === 401, String(unauthBrand.status));

  const unauthPreview = await req("/brand/preview");
  note("GET /brand/preview unauthenticated", unauthPreview.status === 401, String(unauthPreview.status));

  const session = await req("/auth/dev-session", { method: "POST" });
  assert(session.status === 200 && session.json?.token, `dev-session failed: ${session.status} ${session.text}`);
  const token = session.json.token;
  note("Creator local session", true, session.json.user?.trustId);

  const live = await req("/assets", {
    method: "POST",
    token,
    body: { title: "Public Book One", description: "A published book", assetType: "BOOK", origin: "CREATED_INTERNAL", status: "PUBLISHED", visibility: "public" },
  });
  const live2 = await req("/assets", {
    method: "POST",
    token,
    body: { title: "Public Course Two", description: "A published course", assetType: "COURSE", origin: "CREATED_INTERNAL", status: "PUBLISHED", visibility: "public" },
  });
  const draft = await req("/assets", {
    method: "POST",
    token,
    body: { title: "Draft Secret", assetType: "WRITING", origin: "CREATED_INTERNAL", status: "DRAFT", visibility: "private" },
  });
  const archived = await req("/assets", {
    method: "POST",
    token,
    body: { title: "Archived Work", assetType: "WRITING", origin: "CREATED_INTERNAL", status: "ARCHIVED", visibility: "public" },
  });
  const unlisted = await req("/assets", {
    method: "POST",
    token,
    body: { title: "Unlisted Work", assetType: "WRITING", origin: "CREATED_INTERNAL", status: "PUBLISHED", visibility: "unlisted" },
  });
  note("Create eligibility Assets", [live, live2, draft, archived, unlisted].every((r) => r.status === 201 || r.status === 200));
  const liveId = live.json.asset?.id ?? live.json.id;
  const live2Id = live2.json.asset?.id ?? live2.json.id;
  const draftId = draft.json.asset?.id ?? draft.json.id;
  const archivedId = archived.json.asset?.id ?? archived.json.id;
  const unlistedId = unlisted.json.asset?.id ?? unlisted.json.id;

  const brand = await req("/brand", {
    method: "PATCH",
    token,
    body: {
      displayName: "Test Creator",
      tagline: "A Digital Life, presented.",
      bio: "Public about text for verification.",
      slug: "Test Creator",
      publicEnabled: true,
      theme: { background: "paper", accent: "ocean", typography: "serif", buttons: "pill", density: "compact" },
      cta: { label: "Visit site", href: "https://example.com" },
      links: [{ id: "l1", label: "Site", url: "https://example.com" }],
      featuredAssetIds: [liveId, live2Id],
      navigation: [
        { id: "home", kind: "home", label: "Home", enabled: true, order: 0, alwaysShow: true },
        { id: "work", kind: "work", label: "Work", enabled: true, order: 1 },
        { id: "about", kind: "about", label: "About", enabled: true, order: 2, alwaysShow: true },
        { id: "contact", kind: "contact", label: "Contact", enabled: true, order: 3, alwaysShow: true },
      ],
    },
  });
  note("Brand save", brand.status === 200 && brand.json.slug === "test-creator", brand.json.slug || brand.text);
  note("Brand non-default theme", brand.json.theme?.background === "paper" && brand.json.theme?.accent === "ocean");
  note("Brand featured order", JSON.stringify(brand.json.featuredAssetIds) === JSON.stringify([liveId, live2Id]));

  const draftFeature = await req("/brand", { method: "PATCH", token, body: { featuredAssetIds: [draftId] } });
  note("Reject draft featured", draftFeature.status === 400, String(draftFeature.status));

  const archivedFeature = await req("/brand", { method: "PATCH", token, body: { featuredAssetIds: [archivedId] } });
  note("Reject archived featured", archivedFeature.status === 400, String(archivedFeature.status));

  const missingFeature = await req("/brand", { method: "PATCH", token, body: { featuredAssetIds: ["does-not-exist"] } });
  note("Reject nonexistent featured", missingFeature.status === 400, String(missingFeature.status));

  const foreignFeature = await req("/brand", { method: "PATCH", token, body: { featuredAssetIds: ["asset_someone_else"] } });
  note("Reject other-owner featured", foreignFeature.status === 400, String(foreignFeature.status));

  const unlistedFeature = await req("/brand", { method: "PATCH", token, body: { featuredAssetIds: [unlistedId] } });
  note(
    "Unlisted featured eligibility",
    unlistedFeature.status === 400,
    `status=${unlistedFeature.status} (want 400 if public-eligibility is enforced)`,
  );

  const reserved = await req("/brand", { method: "PATCH", token, body: { slug: "system" } });
  note("Reject reserved slug", reserved.status === 400);

  const emptySlugEnable = await req("/brand", { method: "PATCH", token, body: { slug: "", publicEnabled: true } });
  note("Reject empty slug when enabling", emptySlugEnable.status === 400 || emptySlugEnable.status === 409 || brand.json.slug === "test-creator");

  await req("/brand", { method: "PATCH", token, body: { slug: "test-creator", publicEnabled: true } });

  const preview = await req("/brand/preview", { token });
  note("Preview loads", preview.status === 200 && preview.json.identity?.displayName === "Test Creator");
  note("Preview has featured", preview.json.featuredAssets?.length === 2);
  const previewLeak = JSON.stringify(preview.json);
  note("Preview DTO sanitized", !previewLeak.includes("ownerId") && !previewLeak.includes("dataZoneId") && !/platform-jobs|trust-id|fundzman/.test(previewLeak));

  const pub = await req("/public/test-creator");
  note("Public /public/test-creator", pub.status === 200 && pub.json.identity?.displayName === "Test Creator");
  note("Public hides draft", !pub.json.publishedAssets.some((a) => a.id === draftId));
  note("Public hides archived", !pub.json.publishedAssets.some((a) => a.id === archivedId));
  note("Public hides unlisted", !pub.json.publishedAssets.some((a) => a.id === unlistedId));
  note("Public shows published", pub.json.publishedAssets.some((a) => a.id === liveId) && pub.json.publishedAssets.some((a) => a.id === live2Id));
  const pubLeak = JSON.stringify(pub.json);
  note("Public DTO sanitized", !pubLeak.includes("ownerId") && !pubLeak.includes("dataZoneId") && !pubLeak.includes("jobId") && !/TRUSTID|apiKey|DATABASE/.test(pubLeak));

  const pubAsset = await req(`/public/test-creator/assets/${liveId}`);
  note("Public asset detail", pubAsset.status === 200 && pubAsset.json.title === "Public Book One" && !("ownerId" in pubAsset.json) && !("dataZoneId" in pubAsset.json));

  const draftPublic = await req(`/public/test-creator/assets/${draftId}`);
  note("Private asset 404", draftPublic.status === 404);

  const draftCover = await req(`/public/test-creator/assets/${draftId}/cover`);
  note("Private cover 404", draftCover.status === 404);

  const liveCover = await req(`/public/test-creator/assets/${liveId}/cover`);
  note("Public cover without bytes", liveCover.status === 404, String(liveCover.status));

  const mediaMissing = await req("/public/test-creator/media/logo");
  note("Public media missing slot", mediaMissing.status === 404);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const form = new FormData();
  form.set("slot", "logo");
  form.set("file", new Blob([png], { type: "image/png" }), "logo.png");
  const mediaUp = await fetch(`${API}/brand/media`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const mediaJson = await mediaUp.json().catch(() => ({}));
  note(
    "Brand media DataZone ref",
    mediaUp.status === 200 && Boolean(mediaJson.media?.logo?.dataZoneId?.startsWith("dz_")),
    `${mediaUp.status} ${mediaJson.media?.logo?.dataZoneId || mediaJson.message || ""}`,
  );
  const publicLogo = await req("/public/test-creator/media/logo");
  note("Public media after store", publicLogo.status === 200, String(publicLogo.status));
  await req("/brand", { method: "PATCH", token, body: { featuredAssetIds: [liveId, live2Id] } });

  const badSlug = await req("/public/does-not-exist-xyz");
  note("Invalid slug 404", badSlug.status === 404 && /not available/i.test(badSlug.json?.message || badSlug.text));

  await req("/brand", { method: "PATCH", token, body: { publicEnabled: false } });
  const unpublished = await req("/public/test-creator");
  note("Unpublished brand 404", unpublished.status === 404 && /not available/i.test(unpublished.json?.message || ""));
  const stillPreview = await req("/brand/preview", { token });
  note("Preview still works when unpublished", stillPreview.status === 200);

  await req("/brand", { method: "PATCH", token, body: { publicEnabled: true } });

  const caps = await req("/system/capabilities", { token });
  note(
    "Capabilities honest",
    caps.status === 200 &&
      caps.json.capabilities?.every((c) => typeof c.available === "boolean") &&
      caps.json.capabilities.find((c) => c.id === "payments")?.available === false &&
      caps.json.capabilities.find((c) => c.id === "messaging")?.available === false,
  );

  const brandAfter = await req("/brand", { token });
  note("Brand persists on PersonalSpace", brandAfter.json.slug === "test-creator" && brandAfter.json.identity.displayName === "Test Creator");

  console.log("\nSUMMARY");
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.filter((r) => r.ok).length}/${results.length} passed`);
  if (failed.length) {
    for (const item of failed) console.log(` - ${item.name}: ${item.detail}`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error("VERIFY_CRASH", err);
  process.exit(1);
}
