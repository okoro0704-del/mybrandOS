-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "providerAccessToken" TEXT,
ADD COLUMN     "providerTokenExpiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TwinDelegation" (
    "id" TEXT NOT NULL,
    "humanSubject" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "twinId" TEXT NOT NULL,
    "capabilities" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwinDelegation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwinApproval" (
    "id" TEXT NOT NULL,
    "delegationId" TEXT NOT NULL,
    "humanSubject" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwinApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwinActionExecution" (
    "id" TEXT NOT NULL,
    "delegationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "resultId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TwinActionExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwinAuditEvent" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "humanSubject" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "delegationId" TEXT,
    "approvalId" TEXT,
    "action" TEXT NOT NULL,
    "targetId" TEXT,
    "outcome" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TwinAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TwinDelegation_ownerId_createdAt_idx" ON "TwinDelegation"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TwinApproval_tokenHash_key" ON "TwinApproval"("tokenHash");

-- CreateIndex
CREATE INDEX "TwinApproval_ownerId_createdAt_idx" ON "TwinApproval"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "TwinActionExecution_ownerId_createdAt_idx" ON "TwinActionExecution"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TwinActionExecution_delegationId_idempotencyKey_key" ON "TwinActionExecution"("delegationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "TwinAuditEvent_ownerId_createdAt_idx" ON "TwinAuditEvent"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "TwinAuditEvent_correlationId_idx" ON "TwinAuditEvent"("correlationId");

-- AddForeignKey
ALTER TABLE "TwinApproval" ADD CONSTRAINT "TwinApproval_delegationId_fkey" FOREIGN KEY ("delegationId") REFERENCES "TwinDelegation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
