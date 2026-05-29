-- HandoutVersion.contentJson is becoming nullable because structured handouts
-- (Prompt 11d's editor) don't use TipTap JSON. data (added in 11a) is the
-- canonical column for structured handouts; contentJson stays for legacy
-- TipTap-authored versions only. Both columns remain queryable; consumers
-- prefer data when present (see resolveHandoutHtml in @hmp/db).
ALTER TABLE "HandoutVersion" ALTER COLUMN "contentJson" DROP NOT NULL;
