-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowPlugin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "remoteUrl" TEXT NOT NULL,
    "routes" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "icon" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowPlugin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPluginPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pluginName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPluginPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publisher" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "website" TEXT,
    "email" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Publisher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginPackage" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "author" TEXT,
    "authorEmail" TEXT,
    "repository" TEXT,
    "githubRepo" TEXT,
    "license" TEXT,
    "keywords" TEXT[],
    "icon" TEXT,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION,
    "deprecated" BOOLEAN NOT NULL DEFAULT false,
    "isCore" BOOLEAN NOT NULL DEFAULT false,
    "publishStatus" TEXT NOT NULL DEFAULT 'draft',
    "publisherId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginVersion" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "frontendUrl" TEXT,
    "backendImage" TEXT,
    "releaseNotes" TEXT,
    "deprecated" BOOLEAN NOT NULL DEFAULT false,
    "deprecationMsg" TEXT,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PluginVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginInstallation" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "containerPort" INTEGER,
    "databaseName" TEXT,
    "frontendPort" INTEGER,
    "config" JSONB,
    "installedAt" TIMESTAMP(3),
    "lastHealthCheck" TIMESTAMP(3),
    "healthStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PluginDeployment" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "frontendUrl" TEXT,
    "backendUrl" TEXT,
    "containerPort" INTEGER,
    "databaseSchema" TEXT,
    "activeInstalls" INTEGER NOT NULL DEFAULT 0,
    "deployedAt" TIMESTAMP(3),
    "lastHealthCheck" TIMESTAMP(3),
    "healthStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PluginDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantPluginInstall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantPluginInstall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowPlugin_name_key" ON "WorkflowPlugin"("name");

-- CreateIndex
CREATE INDEX "WorkflowPlugin_enabled_order_idx" ON "WorkflowPlugin"("enabled", "order");

-- CreateIndex
CREATE INDEX "UserPluginPreference_userId_idx" ON "UserPluginPreference"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserPluginPreference_userId_pluginName_key" ON "UserPluginPreference"("userId", "pluginName");

-- CreateIndex
CREATE UNIQUE INDEX "Publisher_name_key" ON "Publisher"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Publisher_email_key" ON "Publisher"("email");

-- CreateIndex
CREATE UNIQUE INDEX "PluginPackage_name_key" ON "PluginPackage"("name");

-- CreateIndex
CREATE INDEX "PluginPackage_category_idx" ON "PluginPackage"("category");

-- CreateIndex
CREATE INDEX "PluginPackage_deprecated_idx" ON "PluginPackage"("deprecated");

-- CreateIndex
CREATE INDEX "PluginPackage_publisherId_idx" ON "PluginPackage"("publisherId");

-- CreateIndex
CREATE INDEX "PluginPackage_publishStatus_idx" ON "PluginPackage"("publishStatus");

-- CreateIndex
CREATE INDEX "PluginPackage_isCore_idx" ON "PluginPackage"("isCore");

-- CreateIndex
CREATE INDEX "PluginVersion_packageId_publishedAt_idx" ON "PluginVersion"("packageId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PluginVersion_packageId_version_key" ON "PluginVersion"("packageId", "version");

-- CreateIndex
CREATE INDEX "PluginInstallation_status_idx" ON "PluginInstallation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PluginInstallation_packageId_key" ON "PluginInstallation"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "PluginDeployment_packageId_key" ON "PluginDeployment"("packageId");

-- CreateIndex
CREATE INDEX "PluginDeployment_status_idx" ON "PluginDeployment"("status");

-- CreateIndex
CREATE INDEX "PluginDeployment_healthStatus_idx" ON "PluginDeployment"("healthStatus");

-- CreateIndex
CREATE INDEX "TenantPluginInstall_userId_status_idx" ON "TenantPluginInstall"("userId", "status");

-- CreateIndex
CREATE INDEX "TenantPluginInstall_deploymentId_idx" ON "TenantPluginInstall"("deploymentId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantPluginInstall_userId_deploymentId_key" ON "TenantPluginInstall"("userId", "deploymentId");

-- AddForeignKey
ALTER TABLE "UserPluginPreference" ADD CONSTRAINT "UserPluginPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginPackage" ADD CONSTRAINT "PluginPackage_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "Publisher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginVersion" ADD CONSTRAINT "PluginVersion_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PluginPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginInstallation" ADD CONSTRAINT "PluginInstallation_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PluginPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginInstallation" ADD CONSTRAINT "PluginInstallation_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PluginVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginDeployment" ADD CONSTRAINT "PluginDeployment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PluginPackage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PluginDeployment" ADD CONSTRAINT "PluginDeployment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "PluginVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPluginInstall" ADD CONSTRAINT "TenantPluginInstall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantPluginInstall" ADD CONSTRAINT "TenantPluginInstall_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "PluginDeployment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
