-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "emailVerified" TIMESTAMP(3),
    "address" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "avatarUrl" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "invitedBy" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ipAddress" TEXT,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "preferences" JSONB DEFAULT '{}',
    "debugEnabled" BOOLEAN NOT NULL DEFAULT true,
    "debugDisabledBy" TEXT,
    "debugDisabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "canAssign" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inherits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scope" TEXT NOT NULL DEFAULT 'system',
    "pluginName" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedBy" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_gateways" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "operatorName" TEXT NOT NULL,
    "serviceUri" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "ip" TEXT,
    "status" TEXT NOT NULL DEFAULT 'online',
    "uptime" DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    "latencyP50" INTEGER NOT NULL DEFAULT 0,
    "latencyP99" INTEGER NOT NULL DEFAULT 0,
    "jobsPerMinute" INTEGER NOT NULL DEFAULT 0,
    "deposit" TEXT NOT NULL DEFAULT '0',
    "reserve" TEXT NOT NULL DEFAULT '0',
    "supportedPipelines" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connectedOrchestrators" INTEGER NOT NULL DEFAULT 0,
    "version" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_gateways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_orchestrator_connections" (
    "id" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "orchestratorAddress" TEXT NOT NULL,
    "latencyScore" DOUBLE PRECISION NOT NULL,
    "successRate" DOUBLE PRECISION NOT NULL,
    "jobsSent" INTEGER NOT NULL DEFAULT 0,
    "price" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_orchestrator_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_performance_metrics" (
    "id" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "gateway_performance_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gateway_configs" (
    "id" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "slaConfig" JSONB,
    "pricingConfig" JSONB,
    "networkConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gateway_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "developer_api_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectName" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "gatewayId" TEXT NOT NULL,
    "gatewayName" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "developer_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_transaction_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "chainId" INTEGER NOT NULL,
    "value" TEXT,
    "gasUsed" TEXT,
    "gasPrice" TEXT,
    "blockNumber" INTEGER,
    "toAddress" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_transaction_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_staking_states" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "stakedAmount" TEXT NOT NULL DEFAULT '0',
    "delegatedTo" TEXT,
    "pendingRewards" TEXT NOT NULL DEFAULT '0',
    "pendingFees" TEXT NOT NULL DEFAULT '0',
    "startRound" TEXT,
    "lastClaimRound" TEXT,
    "lastSynced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_staking_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_orchestrators" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "name" TEXT,
    "serviceUri" TEXT,
    "totalStake" TEXT NOT NULL DEFAULT '0',
    "rewardCut" INTEGER NOT NULL DEFAULT 0,
    "feeShare" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSynced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_orchestrators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallet_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "defaultNetwork" TEXT NOT NULL DEFAULT 'arbitrum-one',
    "autoConnect" BOOLEAN NOT NULL DEFAULT true,
    "showTestnets" BOOLEAN NOT NULL DEFAULT false,
    "gasStrategy" TEXT NOT NULL DEFAULT 'standard',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_dashboards" (
    "id" TEXT NOT NULL,
    "metabaseId" INTEGER NOT NULL,
    "entityId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_dashboards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_user_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_plugin_configs" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_plugin_configs_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "community_users" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_posts" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "postType" TEXT NOT NULL DEFAULT 'DISCUSSION',
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "isSolved" BOOLEAN NOT NULL DEFAULT false,
    "acceptedAnswerId" TEXT,
    "isPinned" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_comments" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "isAccepted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_votes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postId" TEXT,
    "commentId" TEXT,

    CONSTRAINT "community_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_tags" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_tags" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "community_post_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_reputation_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_reputation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_badges" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6b7280',
    "criteria" TEXT NOT NULL,
    "threshold" INTEGER NOT NULL DEFAULT 1,
    "points" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_user_badges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeId" TEXT NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_user_badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daydream_settings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiKey" TEXT,
    "defaultPrompt" TEXT NOT NULL DEFAULT 'superman',
    "defaultSeed" INTEGER NOT NULL DEFAULT 42,
    "negativePrompt" TEXT NOT NULL DEFAULT 'blurry, low quality, flat, 2d',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daydream_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daydream_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "playbackId" TEXT,
    "whipUrl" TEXT,
    "prompt" TEXT,
    "seed" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "durationMins" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "daydream_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_address_key" ON "User"("address");

-- CreateIndex
CREATE UNIQUE INDEX "Team_slug_key" ON "Team"("slug");

-- CreateIndex
CREATE INDEX "Team_ownerId_idx" ON "Team"("ownerId");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_idx" ON "TeamMember"("teamId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_role_idx" ON "TeamMember"("teamId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginAttempt_ipAddress_createdAt_idx" ON "LoginAttempt"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX "OAuthAccount_userId_idx" ON "OAuthAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthAccount_provider_providerAccountId_key" ON "OAuthAccount"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "UserConfig_userId_key" ON "UserConfig"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_token_key" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_token_key" ON "EmailVerificationToken"("token");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_token_idx" ON "EmailVerificationToken"("token");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "Role_scope_idx" ON "Role"("scope");

-- CreateIndex
CREATE INDEX "Role_pluginName_idx" ON "Role"("pluginName");

-- CreateIndex
CREATE INDEX "UserRole_userId_idx" ON "UserRole"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_roleId_key" ON "UserRole"("userId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_gateways_address_key" ON "gateway_gateways"("address");

-- CreateIndex
CREATE INDEX "gateway_gateways_status_idx" ON "gateway_gateways"("status");

-- CreateIndex
CREATE INDEX "gateway_gateways_region_idx" ON "gateway_gateways"("region");

-- CreateIndex
CREATE INDEX "gateway_gateways_address_idx" ON "gateway_gateways"("address");

-- CreateIndex
CREATE INDEX "gateway_orchestrator_connections_gatewayId_idx" ON "gateway_orchestrator_connections"("gatewayId");

-- CreateIndex
CREATE INDEX "gateway_orchestrator_connections_orchestratorAddress_idx" ON "gateway_orchestrator_connections"("orchestratorAddress");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_orchestrator_connections_gatewayId_orchestratorAddr_key" ON "gateway_orchestrator_connections"("gatewayId", "orchestratorAddress");

-- CreateIndex
CREATE INDEX "gateway_performance_metrics_gatewayId_timestamp_idx" ON "gateway_performance_metrics"("gatewayId", "timestamp");

-- CreateIndex
CREATE INDEX "gateway_performance_metrics_timestamp_idx" ON "gateway_performance_metrics"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "gateway_configs_gatewayId_key" ON "gateway_configs"("gatewayId");

-- CreateIndex
CREATE UNIQUE INDEX "developer_api_keys_keyHash_key" ON "developer_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "developer_api_keys_userId_idx" ON "developer_api_keys"("userId");

-- CreateIndex
CREATE INDEX "developer_api_keys_status_idx" ON "developer_api_keys"("status");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_connections_userId_key" ON "wallet_connections"("userId");

-- CreateIndex
CREATE INDEX "wallet_connections_address_idx" ON "wallet_connections"("address");

-- CreateIndex
CREATE INDEX "wallet_connections_userId_idx" ON "wallet_connections"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transaction_logs_txHash_key" ON "wallet_transaction_logs"("txHash");

-- CreateIndex
CREATE INDEX "wallet_transaction_logs_userId_timestamp_idx" ON "wallet_transaction_logs"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "wallet_transaction_logs_address_timestamp_idx" ON "wallet_transaction_logs"("address", "timestamp");

-- CreateIndex
CREATE INDEX "wallet_transaction_logs_txHash_idx" ON "wallet_transaction_logs"("txHash");

-- CreateIndex
CREATE INDEX "wallet_transaction_logs_status_idx" ON "wallet_transaction_logs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_staking_states_address_key" ON "wallet_staking_states"("address");

-- CreateIndex
CREATE INDEX "wallet_staking_states_address_idx" ON "wallet_staking_states"("address");

-- CreateIndex
CREATE INDEX "wallet_staking_states_delegatedTo_idx" ON "wallet_staking_states"("delegatedTo");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_orchestrators_address_key" ON "wallet_orchestrators"("address");

-- CreateIndex
CREATE INDEX "wallet_orchestrators_chainId_isActive_idx" ON "wallet_orchestrators"("chainId", "isActive");

-- CreateIndex
CREATE INDEX "wallet_orchestrators_totalStake_idx" ON "wallet_orchestrators"("totalStake");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_settings_userId_key" ON "wallet_settings"("userId");

-- CreateIndex
CREATE INDEX "dashboard_dashboards_isDefault_idx" ON "dashboard_dashboards"("isDefault");

-- CreateIndex
CREATE INDEX "dashboard_dashboards_order_idx" ON "dashboard_dashboards"("order");

-- CreateIndex
CREATE INDEX "dashboard_dashboards_metabaseId_idx" ON "dashboard_dashboards"("metabaseId");

-- CreateIndex
CREATE INDEX "dashboard_user_preferences_userId_idx" ON "dashboard_user_preferences"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_user_preferences_userId_dashboardId_key" ON "dashboard_user_preferences"("userId", "dashboardId");

-- CreateIndex
CREATE UNIQUE INDEX "community_users_walletAddress_key" ON "community_users"("walletAddress");

-- CreateIndex
CREATE INDEX "community_users_walletAddress_idx" ON "community_users"("walletAddress");

-- CreateIndex
CREATE INDEX "community_users_reputation_idx" ON "community_users"("reputation");

-- CreateIndex
CREATE INDEX "community_posts_authorId_idx" ON "community_posts"("authorId");

-- CreateIndex
CREATE INDEX "community_posts_category_idx" ON "community_posts"("category");

-- CreateIndex
CREATE INDEX "community_posts_postType_idx" ON "community_posts"("postType");

-- CreateIndex
CREATE INDEX "community_posts_isSolved_idx" ON "community_posts"("isSolved");

-- CreateIndex
CREATE INDEX "community_posts_createdAt_idx" ON "community_posts"("createdAt");

-- CreateIndex
CREATE INDEX "community_posts_upvotes_idx" ON "community_posts"("upvotes");

-- CreateIndex
CREATE INDEX "community_comments_postId_idx" ON "community_comments"("postId");

-- CreateIndex
CREATE INDEX "community_comments_authorId_idx" ON "community_comments"("authorId");

-- CreateIndex
CREATE INDEX "community_comments_isAccepted_idx" ON "community_comments"("isAccepted");

-- CreateIndex
CREATE INDEX "community_votes_targetType_targetId_idx" ON "community_votes"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "community_votes_userId_targetType_targetId_key" ON "community_votes"("userId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "community_tags_name_key" ON "community_tags"("name");

-- CreateIndex
CREATE UNIQUE INDEX "community_tags_slug_key" ON "community_tags"("slug");

-- CreateIndex
CREATE INDEX "community_tags_slug_idx" ON "community_tags"("slug");

-- CreateIndex
CREATE INDEX "community_tags_usageCount_idx" ON "community_tags"("usageCount");

-- CreateIndex
CREATE UNIQUE INDEX "community_post_tags_postId_tagId_key" ON "community_post_tags"("postId", "tagId");

-- CreateIndex
CREATE INDEX "community_reputation_logs_userId_idx" ON "community_reputation_logs"("userId");

-- CreateIndex
CREATE INDEX "community_reputation_logs_createdAt_idx" ON "community_reputation_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "community_badges_name_key" ON "community_badges"("name");

-- CreateIndex
CREATE UNIQUE INDEX "community_badges_slug_key" ON "community_badges"("slug");

-- CreateIndex
CREATE INDEX "community_badges_slug_idx" ON "community_badges"("slug");

-- CreateIndex
CREATE INDEX "community_user_badges_userId_idx" ON "community_user_badges"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "community_user_badges_userId_badgeId_key" ON "community_user_badges"("userId", "badgeId");

-- CreateIndex
CREATE UNIQUE INDEX "daydream_settings_userId_key" ON "daydream_settings"("userId");

-- CreateIndex
CREATE INDEX "daydream_sessions_userId_idx" ON "daydream_sessions"("userId");

-- CreateIndex
CREATE INDEX "daydream_sessions_streamId_idx" ON "daydream_sessions"("streamId");

-- CreateIndex
CREATE INDEX "daydream_sessions_status_idx" ON "daydream_sessions"("status");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginAttempt" ADD CONSTRAINT "LoginAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthAccount" ADD CONSTRAINT "OAuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserConfig" ADD CONSTRAINT "UserConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_orchestrator_connections" ADD CONSTRAINT "gateway_orchestrator_connections_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateway_gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_performance_metrics" ADD CONSTRAINT "gateway_performance_metrics_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateway_gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gateway_configs" ADD CONSTRAINT "gateway_configs_gatewayId_fkey" FOREIGN KEY ("gatewayId") REFERENCES "gateway_gateways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "community_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "community_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "community_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_votes" ADD CONSTRAINT "community_votes_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "community_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_tags" ADD CONSTRAINT "community_post_tags_postId_fkey" FOREIGN KEY ("postId") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_tags" ADD CONSTRAINT "community_post_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "community_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_reputation_logs" ADD CONSTRAINT "community_reputation_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "community_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_user_badges" ADD CONSTRAINT "community_user_badges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "community_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_user_badges" ADD CONSTRAINT "community_user_badges_badgeId_fkey" FOREIGN KEY ("badgeId") REFERENCES "community_badges"("id") ON DELETE CASCADE ON UPDATE CASCADE;
