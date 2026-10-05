-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AssetOrigin" AS ENUM ('CREATED_INTERNAL', 'IMPORTED_FILE', 'IMPORTED_URL', 'IMPORTED_EXTERNAL', 'LIVE_REPLAY');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('BOOK', 'COURSE', 'VIDEO', 'MUSIC', 'SOFTWARE', 'SERVICE', 'PRODUCT', 'MEMBERSHIP', 'DOCUMENT', 'DESIGN', 'PODCAST', 'WEBSITE', 'DIGITAL_OFFER', 'WRITING', 'OTHER');

-- CreateEnum
CREATE TYPE "CreateMode" AS ENUM ('MANUAL', 'AI', 'IMPORT');

-- CreateEnum
CREATE TYPE "ProductionSourceType" AS ENUM ('CREATOR_LIBRARY', 'DIRECT_UPLOAD', 'SUPPLIED', 'LICENSED', 'SYNDICATED', 'PUBLIC_DOMAIN', 'COMMISSIONED');

-- CreateEnum
CREATE TYPE "ProductionRightsBasis" AS ENUM ('OWNED', 'LICENSED', 'SYNDICATED', 'SUPPLIED', 'COMMISSIONED', 'PUBLIC_DOMAIN', 'OTHER');

-- CreateEnum
CREATE TYPE "BroadcastScheduleStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "authMethod" TEXT NOT NULL DEFAULT 'legacy',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "assetType" "AssetType" NOT NULL,
    "origin" "AssetOrigin" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dataZoneId" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "relationships" TEXT NOT NULL DEFAULT '[]',
    "analytics" TEXT NOT NULL DEFAULT '{}',
    "commerce" TEXT NOT NULL DEFAULT '{}',
    "distribution" TEXT NOT NULL DEFAULT '{}',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "originSource" TEXT,
    "originRef" TEXT,
    "sourceProjectId" TEXT,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "assetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "origin" "AssetOrigin" NOT NULL,
    "source" TEXT,
    "assetIds" TEXT NOT NULL DEFAULT '[]',
    "platformJobId" TEXT,
    "jobStatus" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreationProject" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "projectType" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "origin" "AssetOrigin" NOT NULL DEFAULT 'CREATED_INTERNAL',
    "assetId" TEXT,
    "mode" "CreateMode" NOT NULL DEFAULT 'MANUAL',
    "publishStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "draftState" TEXT NOT NULL DEFAULT '{}',
    "settings" TEXT NOT NULL DEFAULT '{}',
    "currentVersionId" TEXT,
    "derivedFromAssetId" TEXT,
    "lastAutosavedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreationProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentBlock" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "content" TEXT NOT NULL DEFAULT '{}',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "snapshot" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectFile" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "dataZoneId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAction" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL DEFAULT '',
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetRelationship" (
    "id" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "targetAssetId" TEXT NOT NULL,
    "relationshipType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionLibraryItem" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "sourceType" "ProductionSourceType" NOT NULL,
    "rightsBasis" "ProductionRightsBasis" NOT NULL,
    "rightsReference" TEXT,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "territory" TEXT,
    "allowedChannels" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionLibraryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastProgram" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "productionItemId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMs" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastSchedule" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "BroadcastScheduleStatus" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastScheduleEntry" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastScheduleEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastSpaceSync" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "spaceScheduleVersion" INTEGER,
    "mediaReadyCount" INTEGER NOT NULL DEFAULT 0,
    "mediaRequiredCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastSpaceSync_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributionIntent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "assetId" TEXT,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'recorded',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DistributionIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalSpace" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL DEFAULT '',
    "headline" TEXT NOT NULL DEFAULT '',
    "bio" TEXT NOT NULL DEFAULT '',
    "links" TEXT NOT NULL DEFAULT '[]',
    "featuredAssetIds" TEXT NOT NULL DEFAULT '[]',
    "slug" TEXT,
    "publicEnabled" BOOLEAN NOT NULL DEFAULT false,
    "theme" TEXT NOT NULL DEFAULT '{}',
    "publicNav" TEXT NOT NULL DEFAULT '[]',
    "cta" TEXT NOT NULL DEFAULT '{}',
    "brandMedia" TEXT NOT NULL DEFAULT '{}',
    "websitePages" TEXT NOT NULL DEFAULT '[]',
    "presentationConfig" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalSpace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AudienceSegment" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudienceSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookMetadata" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "authorName" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',
    "genre" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "isbn" TEXT NOT NULL DEFAULT '',
    "edition" TEXT NOT NULL DEFAULT '',
    "publisher" TEXT NOT NULL DEFAULT '',
    "copyright" TEXT NOT NULL DEFAULT '',
    "coverFileId" TEXT,
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookChapter" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "kind" TEXT NOT NULL DEFAULT 'CHAPTER',
    "matterType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookChapter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookSection" (
    "id" TEXT NOT NULL,
    "chapterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseMetadata" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "instructorName" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',
    "level" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "estimatedDuration" TEXT NOT NULL DEFAULT '',
    "thumbnailFileId" TEXT,
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseModule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseLesson" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "lessonType" TEXT NOT NULL DEFAULT 'TEXT',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "durationSeconds" INTEGER,
    "thumbnailFileId" TEXT,
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseQuizQuestion" (
    "id" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "questionType" TEXT NOT NULL,
    "answers" TEXT NOT NULL DEFAULT '[]',
    "correctAnswerId" TEXT NOT NULL DEFAULT '',
    "explanation" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseQuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoMetadata" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "aspectRatio" TEXT NOT NULL DEFAULT '16:9',
    "frameRate" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER,
    "sourceFileId" TEXT,
    "thumbnailFileId" TEXT,
    "audioFileId" TEXT,
    "captionFileId" TEXT,
    "renderOutputFileId" TEXT,
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoScene" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "mediaFileId" TEXT,
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoScene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT,
    "sourceAssetId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "replayAssetId" TEXT,
    "replayProjectId" TEXT,
    "finalizeJobId" TEXT,
    "notification" TEXT NOT NULL DEFAULT 'idle',
    "broadcastId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '',
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveDistributionIntent" (
    "id" TEXT NOT NULL,
    "liveSessionId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SELECTED',
    "externalReference" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "retryable" BOOLEAN NOT NULL DEFAULT false,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveDistributionIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicMetadata" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "artistName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "genre" TEXT NOT NULL DEFAULT '',
    "subgenre" TEXT NOT NULL DEFAULT '',
    "releaseDate" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER,
    "coverFileId" TEXT,
    "audioFileId" TEXT,
    "lyricsFileId" TEXT,
    "explicit" BOOLEAN NOT NULL DEFAULT false,
    "collectionKind" TEXT NOT NULL DEFAULT 'SINGLE',
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MusicTrack" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artistName" TEXT NOT NULL DEFAULT '',
    "genre" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "lyrics" TEXT NOT NULL DEFAULT '',
    "coverFileId" TEXT,
    "audioFileId" TEXT,
    "lyricsFileId" TEXT,
    "explicit" BOOLEAN NOT NULL DEFAULT false,
    "durationMs" INTEGER,
    "position" INTEGER NOT NULL,
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MusicTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WritingMetadata" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL DEFAULT '',
    "authorName" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT '',
    "genre" TEXT NOT NULL DEFAULT '',
    "form" TEXT NOT NULL DEFAULT 'ARTICLE',
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WritingMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareMetadata" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '0.1.0',
    "description" TEXT NOT NULL DEFAULT '',
    "developer" TEXT NOT NULL DEFAULT '',
    "license" TEXT NOT NULL DEFAULT '',
    "repositoryUrl" TEXT NOT NULL DEFAULT '',
    "documentationUrl" TEXT NOT NULL DEFAULT '',
    "websiteUrl" TEXT NOT NULL DEFAULT '',
    "platforms" TEXT NOT NULL DEFAULT '[]',
    "publicPackageFileId" TEXT,
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoftwareMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareCollaborator" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'DEVELOPER',
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoftwareCollaborator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareWorkspacePermission" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'PROJECT',
    "scopeRef" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoftwareWorkspacePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareProjectSecret" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "valueCipher" TEXT NOT NULL DEFAULT '',
    "availableToExec" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SoftwareProjectSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoftwareProjectEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoftwareProjectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceItem" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "assetId" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "price" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "fulfillmentType" TEXT NOT NULL DEFAULT '',
    "availability" TEXT NOT NULL DEFAULT 'UNAVAILABLE',
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceCheckout" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CREATED',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "fundzmanRef" TEXT NOT NULL DEFAULT '',
    "failureReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceOrder" (
    "id" TEXT NOT NULL,
    "checkoutId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "paymentState" TEXT NOT NULL,
    "fulfillmentState" TEXT NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "fundzmanRef" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceEntitlement" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "fulfillmentType" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "CommerceEntitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionSession" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "scene" TEXT NOT NULL DEFAULT 'CREATOR',
    "projectId" TEXT,
    "assetId" TEXT,
    "liveSessionId" TEXT,
    "detail" TEXT NOT NULL DEFAULT '',
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionDevice" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "capabilities" TEXT NOT NULL DEFAULT '{}',
    "tokenHash" TEXT NOT NULL DEFAULT '',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionSource" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "detail" TEXT NOT NULL DEFAULT '',
    "deviceId" TEXT,
    "projectId" TEXT,
    "assetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionPairing" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "deviceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionPairing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingSession" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'VIDEO',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "productionSessionId" TEXT,
    "projectId" TEXT,
    "assetId" TEXT,
    "audioEnabled" BOOLEAN NOT NULL DEFAULT true,
    "scene" TEXT NOT NULL DEFAULT 'CREATOR',
    "detail" TEXT NOT NULL DEFAULT '',
    "programMediaZoneId" TEXT,
    "programMediaMime" TEXT NOT NULL DEFAULT '',
    "finalizeJobId" TEXT,
    "extra" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingTrack" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT '',
    "deviceId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "mute" BOOLEAN NOT NULL DEFAULT false,
    "solo" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'EMPTY',
    "beatAssetId" TEXT,
    "sourceAssetId" TEXT,
    "selectedTakeId" TEXT,
    "spatialJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingTake" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'READY',
    "startTime" TIMESTAMP(3),
    "durationMs" INTEGER,
    "dataZoneId" TEXT,
    "mimeType" TEXT NOT NULL DEFAULT '',
    "byteSize" INTEGER,
    "createdBy" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecordingTake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramOutput" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'IDLE',
    "scene" TEXT NOT NULL DEFAULT 'CREATOR',
    "activeVideoSourceId" TEXT,
    "activeAudioSourceIds" TEXT NOT NULL DEFAULT '[]',
    "layout" TEXT NOT NULL DEFAULT 'single',
    "detail" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreviewSession" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "recordingSessionId" TEXT,
    "productionSessionId" TEXT,
    "code" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PROGRAM',
    "status" TEXT NOT NULL DEFAULT 'PREVIEW_READY',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigiAiDraftIdempotency" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigiAiDraftIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DigiAiPublishIdempotency" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "authorizationRef" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigiAiPublishIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_ownerId_idx" ON "Session"("ownerId");

-- CreateIndex
CREATE INDEX "Asset_ownerId_idx" ON "Asset"("ownerId");

-- CreateIndex
CREATE INDEX "Asset_ownerId_assetType_idx" ON "Asset"("ownerId", "assetType");

-- CreateIndex
CREATE INDEX "Asset_ownerId_status_idx" ON "Asset"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Asset_ownerId_origin_idx" ON "Asset"("ownerId", "origin");

-- CreateIndex
CREATE INDEX "Asset_ownerId_updatedAt_idx" ON "Asset"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "Asset_ownerId_createdAt_idx" ON "Asset"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Asset_title_idx" ON "Asset"("title");

-- CreateIndex
CREATE INDEX "Activity_ownerId_createdAt_idx" ON "Activity"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_assetId_createdAt_idx" ON "Activity"("assetId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_ownerId_idx" ON "ImportJob"("ownerId");

-- CreateIndex
CREATE INDEX "ImportJob_platformJobId_idx" ON "ImportJob"("platformJobId");

-- CreateIndex
CREATE INDEX "CreationProject_ownerId_idx" ON "CreationProject"("ownerId");

-- CreateIndex
CREATE INDEX "CreationProject_ownerId_projectType_idx" ON "CreationProject"("ownerId", "projectType");

-- CreateIndex
CREATE INDEX "CreationProject_ownerId_status_idx" ON "CreationProject"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ContentBlock_projectId_position_idx" ON "ContentBlock"("projectId", "position");

-- CreateIndex
CREATE INDEX "ProjectVersion_projectId_idx" ON "ProjectVersion"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectVersion_projectId_number_key" ON "ProjectVersion"("projectId", "number");

-- CreateIndex
CREATE INDEX "ProjectFile_projectId_idx" ON "ProjectFile"("projectId");

-- CreateIndex
CREATE INDEX "ProjectFile_ownerId_idx" ON "ProjectFile"("ownerId");

-- CreateIndex
CREATE INDEX "AiAction_projectId_idx" ON "AiAction"("projectId");

-- CreateIndex
CREATE INDEX "AssetRelationship_sourceAssetId_idx" ON "AssetRelationship"("sourceAssetId");

-- CreateIndex
CREATE INDEX "AssetRelationship_targetAssetId_idx" ON "AssetRelationship"("targetAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetRelationship_sourceAssetId_targetAssetId_relationshipT_key" ON "AssetRelationship"("sourceAssetId", "targetAssetId", "relationshipType");

-- CreateIndex
CREATE INDEX "ProductionLibraryItem_ownerId_idx" ON "ProductionLibraryItem"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionLibraryItem_ownerId_assetId_key" ON "ProductionLibraryItem"("ownerId", "assetId");

-- CreateIndex
CREATE INDEX "BroadcastProgram_ownerId_channelId_idx" ON "BroadcastProgram"("ownerId", "channelId");

-- CreateIndex
CREATE INDEX "BroadcastSchedule_ownerId_channelId_status_idx" ON "BroadcastSchedule"("ownerId", "channelId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastSchedule_ownerId_scheduleId_version_key" ON "BroadcastSchedule"("ownerId", "scheduleId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastScheduleEntry_scheduleId_sequence_key" ON "BroadcastScheduleEntry"("scheduleId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastSpaceSync_ownerId_channelId_key" ON "BroadcastSpaceSync"("ownerId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectMember_projectId_userId_key" ON "ProjectMember"("projectId", "userId");

-- CreateIndex
CREATE INDEX "DistributionIntent_projectId_idx" ON "DistributionIntent"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalSpace_ownerId_key" ON "PersonalSpace"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalSpace_slug_key" ON "PersonalSpace"("slug");

-- CreateIndex
CREATE INDEX "AudienceSegment_ownerId_idx" ON "AudienceSegment"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "BookMetadata_projectId_key" ON "BookMetadata"("projectId");

-- CreateIndex
CREATE INDEX "BookChapter_projectId_position_idx" ON "BookChapter"("projectId", "position");

-- CreateIndex
CREATE INDEX "BookSection_chapterId_position_idx" ON "BookSection"("chapterId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CourseMetadata_projectId_key" ON "CourseMetadata"("projectId");

-- CreateIndex
CREATE INDEX "CourseModule_projectId_position_idx" ON "CourseModule"("projectId", "position");

-- CreateIndex
CREATE INDEX "CourseLesson_moduleId_position_idx" ON "CourseLesson"("moduleId", "position");

-- CreateIndex
CREATE INDEX "CourseQuizQuestion_lessonId_position_idx" ON "CourseQuizQuestion"("lessonId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "VideoMetadata_projectId_key" ON "VideoMetadata"("projectId");

-- CreateIndex
CREATE INDEX "VideoScene_projectId_position_idx" ON "VideoScene"("projectId", "position");

-- CreateIndex
CREATE INDEX "LiveSession_ownerId_status_idx" ON "LiveSession"("ownerId", "status");

-- CreateIndex
CREATE INDEX "LiveSession_status_visibility_idx" ON "LiveSession"("status", "visibility");

-- CreateIndex
CREATE INDEX "LiveSession_projectId_idx" ON "LiveSession"("projectId");

-- CreateIndex
CREATE INDEX "LiveDistributionIntent_liveSessionId_idx" ON "LiveDistributionIntent"("liveSessionId");

-- CreateIndex
CREATE INDEX "LiveDistributionIntent_destination_status_idx" ON "LiveDistributionIntent"("destination", "status");

-- CreateIndex
CREATE UNIQUE INDEX "LiveDistributionIntent_liveSessionId_destination_key" ON "LiveDistributionIntent"("liveSessionId", "destination");

-- CreateIndex
CREATE UNIQUE INDEX "MusicMetadata_projectId_key" ON "MusicMetadata"("projectId");

-- CreateIndex
CREATE INDEX "MusicTrack_projectId_position_idx" ON "MusicTrack"("projectId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "WritingMetadata_projectId_key" ON "WritingMetadata"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "SoftwareMetadata_projectId_key" ON "SoftwareMetadata"("projectId");

-- CreateIndex
CREATE INDEX "SoftwareCollaborator_userId_status_idx" ON "SoftwareCollaborator"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SoftwareCollaborator_projectId_userId_key" ON "SoftwareCollaborator"("projectId", "userId");

-- CreateIndex
CREATE INDEX "SoftwareWorkspacePermission_projectId_userId_idx" ON "SoftwareWorkspacePermission"("projectId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SoftwareWorkspacePermission_projectId_userId_permission_sco_key" ON "SoftwareWorkspacePermission"("projectId", "userId", "permission", "scope", "scopeRef");

-- CreateIndex
CREATE UNIQUE INDEX "SoftwareProjectSecret_projectId_name_key" ON "SoftwareProjectSecret"("projectId", "name");

-- CreateIndex
CREATE INDEX "SoftwareProjectEvent_projectId_createdAt_idx" ON "SoftwareProjectEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "CommerceItem_ownerId_idx" ON "CommerceItem"("ownerId");

-- CreateIndex
CREATE INDEX "CommerceItem_ownerId_status_idx" ON "CommerceItem"("ownerId", "status");

-- CreateIndex
CREATE INDEX "CommerceItem_assetId_idx" ON "CommerceItem"("assetId");

-- CreateIndex
CREATE INDEX "CommerceCheckout_offerId_idx" ON "CommerceCheckout"("offerId");

-- CreateIndex
CREATE INDEX "CommerceCheckout_ownerId_idx" ON "CommerceCheckout"("ownerId");

-- CreateIndex
CREATE INDEX "CommerceCheckout_buyerId_idx" ON "CommerceCheckout"("buyerId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceCheckout_buyerId_idempotencyKey_key" ON "CommerceCheckout"("buyerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceOrder_checkoutId_key" ON "CommerceOrder"("checkoutId");

-- CreateIndex
CREATE INDEX "CommerceOrder_ownerId_idx" ON "CommerceOrder"("ownerId");

-- CreateIndex
CREATE INDEX "CommerceOrder_buyerId_idx" ON "CommerceOrder"("buyerId");

-- CreateIndex
CREATE INDEX "CommerceOrder_offerId_idx" ON "CommerceOrder"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceEntitlement_orderId_key" ON "CommerceEntitlement"("orderId");

-- CreateIndex
CREATE INDEX "CommerceEntitlement_buyerId_idx" ON "CommerceEntitlement"("buyerId");

-- CreateIndex
CREATE INDEX "CommerceEntitlement_assetId_idx" ON "CommerceEntitlement"("assetId");

-- CreateIndex
CREATE INDEX "CommerceEntitlement_ownerId_idx" ON "CommerceEntitlement"("ownerId");

-- CreateIndex
CREATE INDEX "ProductionSession_ownerId_status_idx" ON "ProductionSession"("ownerId", "status");

-- CreateIndex
CREATE INDEX "ProductionSession_liveSessionId_idx" ON "ProductionSession"("liveSessionId");

-- CreateIndex
CREATE INDEX "ProductionDevice_sessionId_idx" ON "ProductionDevice"("sessionId");

-- CreateIndex
CREATE INDEX "ProductionDevice_ownerId_idx" ON "ProductionDevice"("ownerId");

-- CreateIndex
CREATE INDEX "ProductionDevice_tokenHash_idx" ON "ProductionDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "ProductionSource_sessionId_idx" ON "ProductionSource"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionPairing_code_key" ON "ProductionPairing"("code");

-- CreateIndex
CREATE INDEX "ProductionPairing_sessionId_idx" ON "ProductionPairing"("sessionId");

-- CreateIndex
CREATE INDEX "ProductionPairing_ownerId_idx" ON "ProductionPairing"("ownerId");

-- CreateIndex
CREATE INDEX "RecordingSession_ownerId_status_idx" ON "RecordingSession"("ownerId", "status");

-- CreateIndex
CREATE INDEX "RecordingSession_productionSessionId_idx" ON "RecordingSession"("productionSessionId");

-- CreateIndex
CREATE INDEX "RecordingSession_projectId_idx" ON "RecordingSession"("projectId");

-- CreateIndex
CREATE INDEX "RecordingTrack_sessionId_idx" ON "RecordingTrack"("sessionId");

-- CreateIndex
CREATE INDEX "RecordingTake_trackId_idx" ON "RecordingTake"("trackId");

-- CreateIndex
CREATE INDEX "RecordingTake_sessionId_idx" ON "RecordingTake"("sessionId");

-- CreateIndex
CREATE INDEX "RecordingTake_dataZoneId_idx" ON "RecordingTake"("dataZoneId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramOutput_sessionId_key" ON "ProgramOutput"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PreviewSession_code_key" ON "PreviewSession"("code");

-- CreateIndex
CREATE INDEX "PreviewSession_ownerId_idx" ON "PreviewSession"("ownerId");

-- CreateIndex
CREATE INDEX "PreviewSession_recordingSessionId_idx" ON "PreviewSession"("recordingSessionId");

-- CreateIndex
CREATE INDEX "PreviewSession_tokenHash_idx" ON "PreviewSession"("tokenHash");

-- CreateIndex
CREATE INDEX "DigiAiDraftIdempotency_assetId_idx" ON "DigiAiDraftIdempotency"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "DigiAiDraftIdempotency_ownerId_idempotencyKey_key" ON "DigiAiDraftIdempotency"("ownerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "DigiAiPublishIdempotency_assetId_idx" ON "DigiAiPublishIdempotency"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "DigiAiPublishIdempotency_ownerId_idempotencyKey_key" ON "DigiAiPublishIdempotency"("ownerId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentBlock" ADD CONSTRAINT "ContentBlock_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectVersion" ADD CONSTRAINT "ProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAction" ADD CONSTRAINT "AiAction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRelationship" ADD CONSTRAINT "AssetRelationship_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetRelationship" ADD CONSTRAINT "AssetRelationship_targetAssetId_fkey" FOREIGN KEY ("targetAssetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLibraryItem" ADD CONSTRAINT "ProductionLibraryItem_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastProgram" ADD CONSTRAINT "BroadcastProgram_productionItemId_fkey" FOREIGN KEY ("productionItemId") REFERENCES "ProductionLibraryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastScheduleEntry" ADD CONSTRAINT "BroadcastScheduleEntry_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "BroadcastSchedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastScheduleEntry" ADD CONSTRAINT "BroadcastScheduleEntry_programId_fkey" FOREIGN KEY ("programId") REFERENCES "BroadcastProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookMetadata" ADD CONSTRAINT "BookMetadata_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookChapter" ADD CONSTRAINT "BookChapter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookSection" ADD CONSTRAINT "BookSection_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "BookChapter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseMetadata" ADD CONSTRAINT "CourseMetadata_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseModule" ADD CONSTRAINT "CourseModule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseLesson" ADD CONSTRAINT "CourseLesson_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "CourseModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseQuizQuestion" ADD CONSTRAINT "CourseQuizQuestion_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "CourseLesson"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMetadata" ADD CONSTRAINT "VideoMetadata_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoScene" ADD CONSTRAINT "VideoScene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveDistributionIntent" ADD CONSTRAINT "LiveDistributionIntent_liveSessionId_fkey" FOREIGN KEY ("liveSessionId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicMetadata" ADD CONSTRAINT "MusicMetadata_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MusicTrack" ADD CONSTRAINT "MusicTrack_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingMetadata" ADD CONSTRAINT "WritingMetadata_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoftwareMetadata" ADD CONSTRAINT "SoftwareMetadata_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoftwareCollaborator" ADD CONSTRAINT "SoftwareCollaborator_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoftwareWorkspacePermission" ADD CONSTRAINT "SoftwareWorkspacePermission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoftwareProjectSecret" ADD CONSTRAINT "SoftwareProjectSecret_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoftwareProjectEvent" ADD CONSTRAINT "SoftwareProjectEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "CreationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceCheckout" ADD CONSTRAINT "CommerceCheckout_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CommerceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "CommerceCheckout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CommerceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceEntitlement" ADD CONSTRAINT "CommerceEntitlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CommerceOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommerceEntitlement" ADD CONSTRAINT "CommerceEntitlement_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "CommerceItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionDevice" ADD CONSTRAINT "ProductionDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProductionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionSource" ADD CONSTRAINT "ProductionSource_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProductionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionSource" ADD CONSTRAINT "ProductionSource_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ProductionDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionPairing" ADD CONSTRAINT "ProductionPairing_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ProductionSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingTrack" ADD CONSTRAINT "RecordingTrack_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RecordingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingTake" ADD CONSTRAINT "RecordingTake_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "RecordingTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingTake" ADD CONSTRAINT "RecordingTake_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RecordingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramOutput" ADD CONSTRAINT "ProgramOutput_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "RecordingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreviewSession" ADD CONSTRAINT "PreviewSession_recordingSessionId_fkey" FOREIGN KEY ("recordingSessionId") REFERENCES "RecordingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
