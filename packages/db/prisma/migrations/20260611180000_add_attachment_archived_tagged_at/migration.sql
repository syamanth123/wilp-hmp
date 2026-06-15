-- Add Attachment.archivedTaggedAt (Prompt 21 reconciliation). Records when the
-- `archived=true` S3 tag was confirmed applied; NULL means "not yet tagged",
-- which the reconciliation sweep detects + repairs. Additive nullable column —
-- no data risk, NO backfill (existing rows stay NULL = "unknown, checked next
-- sweep"; backfilling a timestamp would falsely assert "already tagged").

ALTER TABLE "Attachment" ADD COLUMN "archivedTaggedAt" TIMESTAMP(3);
