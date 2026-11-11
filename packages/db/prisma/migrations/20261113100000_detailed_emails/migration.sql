-- v1.4.3: detailed emails. Additive only.

-- Admin edits of email wording (rows keyed "email:<catalogue key>").
ALTER TABLE "NotificationTemplate" ADD COLUMN "audience" TEXT;
ALTER TABLE "NotificationTemplate" ADD COLUMN "action" TEXT;
ALTER TABLE "NotificationTemplate" ADD COLUMN "editedById" TEXT;
ALTER TABLE "NotificationTemplate" ADD COLUMN "editedAt" TIMESTAMP(3);

-- Reply-to address and help contact for every email.
ALTER TABLE "WorkflowConfig" ADD COLUMN "emailReplyTo" TEXT;
ALTER TABLE "WorkflowConfig" ADD COLUMN "emailHelp" TEXT;

-- The email log.
CREATE INDEX "Notification_channel_createdAt_idx" ON "Notification"("channel", "createdAt");
