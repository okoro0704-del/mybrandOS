-- CreateEnum
CREATE TYPE "PostCommentStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'DELETED');

-- CreateEnum
CREATE TYPE "PostReactionType" AS ENUM ('LOVE');

-- CreateTable
CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "parentCommentId" TEXT,
    "body" TEXT NOT NULL,
    "status" "PostCommentStatus" NOT NULL DEFAULT 'VISIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostReaction" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reactionType" "PostReactionType" NOT NULL DEFAULT 'LOVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetEngagement" (
    "assetId" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "plays" INTEGER NOT NULL DEFAULT 0,
    "completions" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssetEngagement_pkey" PRIMARY KEY ("assetId")
);

-- CreateIndex
CREATE INDEX "PostComment_assetId_createdAt_idx" ON "PostComment"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "PostComment_authorId_createdAt_idx" ON "PostComment"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "PostComment_parentCommentId_idx" ON "PostComment"("parentCommentId");

-- CreateIndex
CREATE INDEX "PostReaction_assetId_reactionType_idx" ON "PostReaction"("assetId", "reactionType");

-- CreateIndex
CREATE INDEX "PostReaction_actorId_idx" ON "PostReaction"("actorId");

-- CreateIndex
CREATE UNIQUE INDEX "PostReaction_assetId_actorId_reactionType_key" ON "PostReaction"("assetId", "actorId", "reactionType");

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostComment" ADD CONSTRAINT "PostComment_parentCommentId_fkey" FOREIGN KEY ("parentCommentId") REFERENCES "PostComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostReaction" ADD CONSTRAINT "PostReaction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetEngagement" ADD CONSTRAINT "AssetEngagement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
