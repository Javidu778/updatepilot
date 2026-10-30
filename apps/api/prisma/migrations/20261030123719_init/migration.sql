-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'UNSUPPORTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "UpdateStatus" AS ENUM ('UP_TO_DATE', 'UPDATE_AVAILABLE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('QUEUED', 'RUNNING', 'VERIFYING', 'SUCCEEDED', 'FAILED', 'RESTART_REQUIRED', 'CANCELLED', 'INTERRUPTED', 'VERIFICATION_FAILED');

-- CreateEnum
CREATE TYPE "VerificationResult" AS ENUM ('NOT_RUN', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditEventType" AS ENUM ('USER_REGISTERED', 'USER_LOGIN', 'DEVICE_PAIRING_CODE_CREATED', 'DEVICE_PAIRED', 'DEVICE_REVOKED', 'CREDENTIAL_ROTATED', 'SCAN_REQUESTED', 'SCAN_COMPLETED', 'SCAN_FAILED', 'UPDATE_PREVIEWED', 'UPDATE_CONFIRMED', 'UPDATE_STARTED', 'UPDATE_COMPLETED', 'UPDATE_FAILED', 'UPDATE_VERIFIED', 'UPDATE_VERIFICATION_FAILED', 'SETTINGS_CHANGED', 'EXPORT_CREATED', 'UNAUTHORIZED_ATTEMPT');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "osVersion" TEXT,
    "agentVersion" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'PENDING',
    "lastSeenAt" TIMESTAMP(3),
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCredential" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AgentCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PairingCode" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "deviceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PairingCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "appKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "publisher" TEXT,
    "installedVersion" TEXT NOT NULL,
    "packageId" TEXT,
    "source" TEXT,
    "architecture" TEXT,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'UNKNOWN',
    "updateStatus" "UpdateStatus" NOT NULL DEFAULT 'UNKNOWN',
    "availableVersion" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanJob" (
    "id" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "requestedById" UUID,
    "state" "JobState" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "appCount" INTEGER,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationSnapshot" (
    "id" UUID NOT NULL,
    "scanJobId" UUID NOT NULL,
    "applicationId" UUID,
    "appKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "publisher" TEXT,
    "installedVersion" TEXT NOT NULL,
    "packageId" TEXT,
    "source" TEXT,
    "matchStatus" "MatchStatus" NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseMetadata" (
    "id" UUID NOT NULL,
    "packageId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'stable',
    "releaseDate" TIMESTAMP(3),
    "changelogUrl" TEXT,
    "officialUrl" TEXT,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isSample" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReleaseMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateJob" (
    "id" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "deviceId" UUID NOT NULL,
    "initiatedById" UUID,
    "packageId" TEXT NOT NULL,
    "fromVersion" TEXT NOT NULL,
    "targetVersion" TEXT NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "exitCode" INTEGER,
    "restartRequired" BOOLEAN NOT NULL DEFAULT false,
    "verification" "VerificationResult" NOT NULL DEFAULT 'NOT_RUN',
    "verifiedVersion" TEXT,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpdateJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" UUID,
    "deviceId" UUID,
    "eventType" "AuditEventType" NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityFinding" (
    "id" UUID NOT NULL,
    "packageId" TEXT NOT NULL,
    "advisoryId" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'UNKNOWN',
    "summary" TEXT,
    "affectedRange" TEXT NOT NULL,
    "fixedVersion" TEXT,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "isSample" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityFinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Device_ownerId_idx" ON "Device"("ownerId");

-- CreateIndex
CREATE INDEX "Device_status_idx" ON "Device"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCredential_tokenHash_key" ON "AgentCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "AgentCredential_deviceId_idx" ON "AgentCredential"("deviceId");

-- CreateIndex
CREATE UNIQUE INDEX "PairingCode_codeHash_key" ON "PairingCode"("codeHash");

-- CreateIndex
CREATE INDEX "PairingCode_userId_idx" ON "PairingCode"("userId");

-- CreateIndex
CREATE INDEX "PairingCode_expiresAt_idx" ON "PairingCode"("expiresAt");

-- CreateIndex
CREATE INDEX "Application_deviceId_displayName_idx" ON "Application"("deviceId", "displayName");

-- CreateIndex
CREATE INDEX "Application_deviceId_updateStatus_idx" ON "Application"("deviceId", "updateStatus");

-- CreateIndex
CREATE INDEX "Application_packageId_idx" ON "Application"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_deviceId_appKey_key" ON "Application"("deviceId", "appKey");

-- CreateIndex
CREATE INDEX "ScanJob_deviceId_createdAt_idx" ON "ScanJob"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "ScanJob_state_idx" ON "ScanJob"("state");

-- CreateIndex
CREATE UNIQUE INDEX "ScanJob_deviceId_idempotencyKey_key" ON "ScanJob"("deviceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ApplicationSnapshot_applicationId_capturedAt_idx" ON "ApplicationSnapshot"("applicationId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationSnapshot_scanJobId_appKey_key" ON "ApplicationSnapshot"("scanJobId", "appKey");

-- CreateIndex
CREATE INDEX "ReleaseMetadata_packageId_idx" ON "ReleaseMetadata"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseMetadata_packageId_version_channel_source_key" ON "ReleaseMetadata"("packageId", "version", "channel", "source");

-- CreateIndex
CREATE INDEX "UpdateJob_applicationId_requestedAt_idx" ON "UpdateJob"("applicationId", "requestedAt");

-- CreateIndex
CREATE INDEX "UpdateJob_deviceId_state_idx" ON "UpdateJob"("deviceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "UpdateJob_deviceId_idempotencyKey_key" ON "UpdateJob"("deviceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "AuditEvent_deviceId_createdAt_idx" ON "AuditEvent"("deviceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_eventType_createdAt_idx" ON "AuditEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityFinding_packageId_idx" ON "SecurityFinding"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityFinding_packageId_advisoryId_source_key" ON "SecurityFinding"("packageId", "advisoryId", "source");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCredential" ADD CONSTRAINT "AgentCredential_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingCode" ADD CONSTRAINT "PairingCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PairingCode" ADD CONSTRAINT "PairingCode_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanJob" ADD CONSTRAINT "ScanJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSnapshot" ADD CONSTRAINT "ApplicationSnapshot_scanJobId_fkey" FOREIGN KEY ("scanJobId") REFERENCES "ScanJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationSnapshot" ADD CONSTRAINT "ApplicationSnapshot_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateJob" ADD CONSTRAINT "UpdateJob_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateJob" ADD CONSTRAINT "UpdateJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateJob" ADD CONSTRAINT "UpdateJob_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
