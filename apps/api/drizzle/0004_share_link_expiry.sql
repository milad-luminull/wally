ALTER TABLE "board_members" ADD COLUMN "joined_by_link" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "share_links" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
-- Links that exist at the release expire 30 days after it (owner, 2026-11-04). The migration
-- runs in the release, so now() is the release time.
UPDATE "share_links" SET "expires_at" = now() + interval '30 days';
