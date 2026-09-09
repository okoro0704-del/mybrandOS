import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const OWNER = "TD-LOCAL-MYBRANDOS";

async function main() {
  await prisma.activity.deleteMany({ where: { ownerId: OWNER } });
  await prisma.asset.deleteMany({ where: { ownerId: OWNER } });
  await prisma.personalSpace.deleteMany({ where: { ownerId: OWNER } });
  await prisma.audienceSegment.deleteMany({ where: { ownerId: OWNER } });
  await prisma.commerceItem.deleteMany({ where: { ownerId: OWNER } });
  await prisma.creationProject.deleteMany({ where: { ownerId: OWNER } });
  await prisma.importJob.deleteMany({ where: { ownerId: OWNER } });

  const now = Date.now();
  const daysAgo = (d: number) => new Date(now - d * 86_400_000);

  const assets = await prisma.$transaction([
    prisma.asset.create({
      data: {
        ownerId: OWNER,
        title: "The Operating Life",
        description: "A book on building a sovereign digital life.",
        assetType: "BOOK",
        origin: "CREATED_INTERNAL",
        status: "PUBLISHED",
        visibility: "public",
        createdAt: daysAgo(40),
        metadata: JSON.stringify({ pages: 214, createdVia: "launcher" }),
      },
    }),
    prisma.asset.create({
      data: {
        ownerId: OWNER,
        title: "Digital Life Systems",
        description: "Imported manuscript from an external drive.",
        assetType: "BOOK",
        origin: "IMPORTED_FILE",
        status: "DRAFT",
        originSource: "digital-life-systems.epub",
        createdAt: daysAgo(12),
        metadata: JSON.stringify({ filename: "digital-life-systems.epub", firstClass: true }),
      },
    }),
    prisma.asset.create({
      data: {
        ownerId: OWNER,
        title: "Audience Kernel",
        description: "A course outline. Studio not built yet.",
        assetType: "COURSE",
        origin: "CREATED_INTERNAL",
        status: "DRAFT",
        createdAt: daysAgo(8),
      },
    }),
    prisma.asset.create({
      data: {
        ownerId: OWNER,
        title: "Keynote: Own Your Stack",
        description: "Talk recording imported from a URL.",
        assetType: "VIDEO",
        origin: "IMPORTED_URL",
        status: "PUBLISHED",
        visibility: "unlisted",
        originSource: "https://example.com/own-your-stack",
        createdAt: daysAgo(21),
      },
    }),
    prisma.asset.create({
      data: {
        ownerId: OWNER,
        title: "Night Work",
        description: "Instrumental collection.",
        assetType: "MUSIC",
        origin: "IMPORTED_FILE",
        status: "PUBLISHED",
        originSource: "night-work.zip",
        createdAt: daysAgo(30),
      },
    }),
    prisma.asset.create({
      data: {
        ownerId: OWNER,
        title: "Brand Ledger",
        description: "Internal utility. Software studio not built yet.",
        assetType: "SOFTWARE",
        origin: "CREATED_INTERNAL",
        status: "DRAFT",
        createdAt: daysAgo(4),
      },
    }),
    prisma.asset.create({
      data: {
        ownerId: OWNER,
        title: "1:1 Brand Audit",
        description: "Service offer linked to commerce.",
        assetType: "SERVICE",
        origin: "CREATED_INTERNAL",
        status: "PUBLISHED",
        visibility: "public",
        createdAt: daysAgo(18),
        commerce: JSON.stringify({ monetized: true, currency: "NGN" }),
      },
    }),
    prisma.asset.create({
      data: {
        ownerId: OWNER,
        title: "Field Notes Template",
        description: "Design file imported from Figma export.",
        assetType: "DESIGN",
        origin: "IMPORTED_EXTERNAL",
        status: "ARCHIVED",
        originSource: "figma",
        originRef: "file-notes-01",
        createdAt: daysAgo(60),
      },
    }),
  ]);

  await prisma.personalSpace.create({
    data: {
      ownerId: OWNER,
      displayName: "Ada",
      headline: "Building a Digital Life Operating System.",
      bio: "Assets first. Origin is metadata.",
      links: JSON.stringify([
        { id: "l1", label: "Personal Space", url: "https://space.example" },
      ]),
    },
  });

  await prisma.audienceSegment.createMany({
    data: [
      { ownerId: OWNER, name: "Followers", count: 0 },
      { ownerId: OWNER, name: "Subscribers", count: 0 },
      { ownerId: OWNER, name: "Customers", count: 0 },
      { ownerId: OWNER, name: "Members", count: 0 },
      { ownerId: OWNER, name: "Community", count: 0 },
    ],
  });

  const service = assets.find((a) => a.assetType === "SERVICE");
  const book = assets.find((a) => a.title === "The Operating Life");
  if (service && book) {
    await prisma.commerceItem.createMany({
      data: [
        { ownerId: OWNER, kind: "SERVICE", title: service.title, status: "live", assetId: service.id },
        { ownerId: OWNER, kind: "PRODUCT", title: book.title, status: "live", assetId: book.id },
        { ownerId: OWNER, kind: "OFFER", title: "Launch bundle", status: "draft", assetId: book.id },
      ],
    });
  }

  await prisma.activity.createMany({
    data: assets.map((a, i) => ({
      ownerId: OWNER,
      kind: a.origin === "CREATED_INTERNAL" ? "created" : "imported",
      title: `${a.origin === "CREATED_INTERNAL" ? "Created" : "Imported"} ${a.title}`,
      detail: `${a.assetType} · ${a.origin}`,
      assetId: a.id,
      createdAt: daysAgo(i + 1),
    })),
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
