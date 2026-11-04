CREATE TABLE "deleted_identities" (
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "deleted_identities_issuer_subject_pk" PRIMARY KEY("issuer","subject")
);
--> statement-breakpoint
ALTER TABLE "deleted_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whiteboards" DROP CONSTRAINT "whiteboards_owner_id_users_id_fk";
--> statement-breakpoint
CREATE INDEX "deleted_identities_expires_at_index" ON "deleted_identities" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_history" ADD CONSTRAINT "note_history_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_audit" ADD CONSTRAINT "assistant_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "note_history_actor_id_index" ON "note_history" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "notes_created_by_id_index" ON "notes" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "notes_assignee_id_index" ON "notes" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "assistant_audit_actor_id_index" ON "assistant_audit" USING btree ("actor_id");