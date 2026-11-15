-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'CASHIER', 'SUPPORT');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PackageDurationUnit" AS ENUM ('MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "PaymentProviderCode" AS ENUM ('SELCOM', 'CLICKPESA', 'MOCK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubscriptionSource" AS ENUM ('PAYMENT', 'VOUCHER', 'ADMIN');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED', 'EXHAUSTED');

-- CreateEnum
CREATE TYPE "SoldChannel" AS ENUM ('CASH', 'MOBILE_MONEY');

-- CreateEnum
CREATE TYPE "WifiSessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'DISCONNECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "NetworkAuthorizationStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'REVOKED', 'FAILED');

-- CreateEnum
CREATE TYPE "AccessPointStatus" AS ENUM ('ONLINE', 'OFFLINE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL', 'IN_APP');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "BackgroundJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" "RoleName" NOT NULL,
    "description" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "fullName" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "email" TEXT,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "notes" TEXT,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'sw',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerDevice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "macAddress" TEXT NOT NULL,
    "lastIpAddress" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "address" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OmadaController" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "encryptedPassword" TEXT NOT NULL,
    "verifySsl" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastError" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OmadaController_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkSite" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "controllerId" TEXT NOT NULL,
    "omadaSiteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessPoint" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "networkSiteId" TEXT NOT NULL,
    "macAddress" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "status" "AccessPointStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccessPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationValue" INTEGER NOT NULL,
    "durationUnit" "PackageDurationUnit" NOT NULL,
    "priceTzs" INTEGER NOT NULL,
    "dataLimitMb" INTEGER,
    "downloadKbps" INTEGER,
    "uploadKbps" INTEGER,
    "maxDevices" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackagePrice" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "amountTzs" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PackagePrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageFeature" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PackageFeature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageLocation" (
    "packageId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "PackageLocation_pkey" PRIMARY KEY ("packageId","locationId")
);

-- CreateTable
CREATE TABLE "PaymentProvider" (
    "id" TEXT NOT NULL,
    "code" "PaymentProviderCode" NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amountTzs" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "phoneNumber" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerTransactionId" TEXT,
    "idempotencyKey" TEXT,
    "failureReason" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestSnapshot" JSONB,
    "responseSnapshot" JSONB,
    "httpStatus" INTEGER,
    "succeeded" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhook" (
    "id" TEXT NOT NULL,
    "providerCode" "PaymentProviderCode" NOT NULL,
    "externalEventId" TEXT,
    "paymentId" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,

    CONSTRAINT "PaymentWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountTzs" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerRefundId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "networkSiteId" TEXT,
    "paymentId" TEXT,
    "voucherId" TEXT,
    "sourceType" "SubscriptionSource" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "remainingDataMb" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionDevice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "customerDeviceId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "SubscriptionDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionHistory" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "fromStatus" "SubscriptionStatus",
    "toStatus" "SubscriptionStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "usageLimit" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "packageId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "codeCiphertext" TEXT,
    "usageLimit" INTEGER NOT NULL DEFAULT 1,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "VoucherStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3),
    "soldByUserId" TEXT,
    "soldAt" TIMESTAMP(3),
    "soldChannel" "SoldChannel",
    "soldAmountTzs" INTEGER,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherRedemption" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "customerId" TEXT,
    "subscriptionId" TEXT,
    "macAddress" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoucherRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WifiSession" (
    "id" TEXT NOT NULL,
    "externalSessionId" TEXT,
    "customerId" TEXT,
    "customerDeviceId" TEXT,
    "macAddress" TEXT NOT NULL,
    "ipAddress" TEXT,
    "accessPointId" TEXT,
    "networkSiteId" TEXT,
    "subscriptionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "status" "WifiSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "disconnectReason" TEXT,
    "bytesUploaded" BIGINT NOT NULL DEFAULT 0,
    "bytesDownloaded" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WifiSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WifiSessionEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WifiSessionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkAuthorization" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "networkSiteId" TEXT NOT NULL,
    "macAddress" TEXT NOT NULL,
    "status" "NetworkAuthorizationStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "authorizedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NetworkAuthorization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "userId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "IntegrationConfiguration" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NetworkEvent" (
    "id" TEXT NOT NULL,
    "networkSiteId" TEXT,
    "accessPointId" TEXT,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetworkEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJobRecord" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobKey" TEXT,
    "payload" JSONB,
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackgroundJobRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_code_key" ON "Permission"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_replacedById_key" ON "RefreshToken"("replacedById");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_phoneNumber_key" ON "Customer"("phoneNumber");

-- CreateIndex
CREATE INDEX "Customer_status_idx" ON "Customer"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_customerId_key" ON "CustomerProfile"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerDevice_macAddress_key" ON "CustomerDevice"("macAddress");

-- CreateIndex
CREATE INDEX "CustomerDevice_customerId_idx" ON "CustomerDevice"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_code_key" ON "Location"("code");

-- CreateIndex
CREATE INDEX "NetworkSite_locationId_idx" ON "NetworkSite"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "NetworkSite_controllerId_omadaSiteId_key" ON "NetworkSite"("controllerId", "omadaSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "AccessPoint_macAddress_key" ON "AccessPoint"("macAddress");

-- CreateIndex
CREATE INDEX "AccessPoint_networkSiteId_idx" ON "AccessPoint"("networkSiteId");

-- CreateIndex
CREATE INDEX "AccessPoint_status_idx" ON "AccessPoint"("status");

-- CreateIndex
CREATE INDEX "Package_isActive_isArchived_idx" ON "Package"("isActive", "isArchived");

-- CreateIndex
CREATE INDEX "PackagePrice_packageId_effectiveFrom_idx" ON "PackagePrice"("packageId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProvider_code_key" ON "PaymentProvider"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_customerId_idx" ON "Payment"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerId_providerTransactionId_key" ON "Payment"("providerId", "providerTransactionId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_paymentId_idx" ON "PaymentTransaction"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentWebhook_paymentId_idx" ON "PaymentWebhook"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhook_providerCode_externalEventId_key" ON "PaymentWebhook"("providerCode", "externalEventId");

-- CreateIndex
CREATE INDEX "PaymentRefund_paymentId_idx" ON "PaymentRefund"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_paymentId_key" ON "Subscription"("paymentId");

-- CreateIndex
CREATE INDEX "Subscription_status_expiresAt_idx" ON "Subscription"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Subscription_customerId_idx" ON "Subscription"("customerId");

-- CreateIndex
CREATE INDEX "Subscription_voucherId_idx" ON "Subscription"("voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionDevice_subscriptionId_customerDeviceId_key" ON "SubscriptionDevice"("subscriptionId", "customerDeviceId");

-- CreateIndex
CREATE INDEX "SubscriptionHistory_subscriptionId_idx" ON "SubscriptionHistory"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_codeHash_key" ON "Voucher"("codeHash");

-- CreateIndex
CREATE INDEX "Voucher_status_expiresAt_idx" ON "Voucher"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Voucher_batchId_idx" ON "Voucher"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "VoucherRedemption_subscriptionId_key" ON "VoucherRedemption"("subscriptionId");

-- CreateIndex
CREATE INDEX "VoucherRedemption_voucherId_idx" ON "VoucherRedemption"("voucherId");

-- CreateIndex
CREATE INDEX "VoucherRedemption_macAddress_idx" ON "VoucherRedemption"("macAddress");

-- CreateIndex
CREATE UNIQUE INDEX "WifiSession_externalSessionId_key" ON "WifiSession"("externalSessionId");

-- CreateIndex
CREATE INDEX "WifiSession_macAddress_status_idx" ON "WifiSession"("macAddress", "status");

-- CreateIndex
CREATE INDEX "WifiSession_status_expiresAt_idx" ON "WifiSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "WifiSession_subscriptionId_idx" ON "WifiSession"("subscriptionId");

-- CreateIndex
CREATE INDEX "WifiSessionEvent_sessionId_idx" ON "WifiSessionEvent"("sessionId");

-- CreateIndex
CREATE INDEX "NetworkAuthorization_networkSiteId_macAddress_idx" ON "NetworkAuthorization"("networkSiteId", "macAddress");

-- CreateIndex
CREATE INDEX "NetworkAuthorization_status_idx" ON "NetworkAuthorization"("status");

-- CreateIndex
CREATE INDEX "Notification_customerId_idx" ON "Notification"("customerId");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfiguration_provider_key" ON "IntegrationConfiguration"("provider");

-- CreateIndex
CREATE INDEX "NetworkEvent_networkSiteId_createdAt_idx" ON "NetworkEvent"("networkSiteId", "createdAt");

-- CreateIndex
CREATE INDEX "NetworkEvent_accessPointId_idx" ON "NetworkEvent"("accessPointId");

-- CreateIndex
CREATE UNIQUE INDEX "BackgroundJobRecord_jobKey_key" ON "BackgroundJobRecord"("jobKey");

-- CreateIndex
CREATE INDEX "BackgroundJobRecord_status_runAt_idx" ON "BackgroundJobRecord"("status", "runAt");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerDevice" ADD CONSTRAINT "CustomerDevice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkSite" ADD CONSTRAINT "NetworkSite_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkSite" ADD CONSTRAINT "NetworkSite_controllerId_fkey" FOREIGN KEY ("controllerId") REFERENCES "OmadaController"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessPoint" ADD CONSTRAINT "AccessPoint_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessPoint" ADD CONSTRAINT "AccessPoint_networkSiteId_fkey" FOREIGN KEY ("networkSiteId") REFERENCES "NetworkSite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackagePrice" ADD CONSTRAINT "PackagePrice_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageFeature" ADD CONSTRAINT "PackageFeature_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageLocation" ADD CONSTRAINT "PackageLocation_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageLocation" ADD CONSTRAINT "PackageLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "PaymentProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentWebhook" ADD CONSTRAINT "PaymentWebhook_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_networkSiteId_fkey" FOREIGN KEY ("networkSiteId") REFERENCES "NetworkSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionDevice" ADD CONSTRAINT "SubscriptionDevice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionDevice" ADD CONSTRAINT "SubscriptionDevice_customerDeviceId_fkey" FOREIGN KEY ("customerDeviceId") REFERENCES "CustomerDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionHistory" ADD CONSTRAINT "SubscriptionHistory_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherBatch" ADD CONSTRAINT "VoucherBatch_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "VoucherBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherRedemption" ADD CONSTRAINT "VoucherRedemption_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WifiSession" ADD CONSTRAINT "WifiSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WifiSession" ADD CONSTRAINT "WifiSession_customerDeviceId_fkey" FOREIGN KEY ("customerDeviceId") REFERENCES "CustomerDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WifiSession" ADD CONSTRAINT "WifiSession_accessPointId_fkey" FOREIGN KEY ("accessPointId") REFERENCES "AccessPoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WifiSession" ADD CONSTRAINT "WifiSession_networkSiteId_fkey" FOREIGN KEY ("networkSiteId") REFERENCES "NetworkSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WifiSession" ADD CONSTRAINT "WifiSession_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WifiSessionEvent" ADD CONSTRAINT "WifiSessionEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WifiSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkAuthorization" ADD CONSTRAINT "NetworkAuthorization_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkAuthorization" ADD CONSTRAINT "NetworkAuthorization_networkSiteId_fkey" FOREIGN KEY ("networkSiteId") REFERENCES "NetworkSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
