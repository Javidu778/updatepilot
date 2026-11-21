-- CreateTable
CREATE TABLE "PreviewToken" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "packageId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fromVersion" TEXT NOT NULL,
    "targetVersion" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PreviewToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PreviewToken_tokenHash_key" ON "PreviewToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PreviewToken_userId_idx" ON "PreviewToken"("userId");

-- CreateIndex
CREATE INDEX "PreviewToken_expiresAt_idx" ON "PreviewToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "PreviewToken" ADD CONSTRAINT "PreviewToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreviewToken" ADD CONSTRAINT "PreviewToken_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;
