CREATE TABLE "auth_identities" (
	"issuer" text NOT NULL,
	"subject" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_identities_issuer_subject_pk" PRIMARY KEY("issuer","subject")
);
--> statement-breakpoint
ALTER TABLE "auth_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mcp_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"issued_after" bigint NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "mcp_connections_scopes_check" CHECK ("mcp_connections"."scopes" <@ array['wally:read', 'wally:write']::text[])
);
--> statement-breakpoint
ALTER TABLE "mcp_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mcp_limits" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"window" bigint NOT NULL,
	"count" integer NOT NULL,
	"connections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "mcp_limits_user_id_kind_pk" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "mcp_limits_kind_check" CHECK ("mcp_limits"."kind" in ('writes', 'requests'))
);
--> statement-breakpoint
ALTER TABLE "mcp_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"email_verified" boolean NOT NULL,
	"language" text NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_language_check" CHECK ("users"."language" in ('de', 'en'))
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "board_members" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"user_id" text,
	"invited_email" text,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"invited_at" timestamp with time zone NOT NULL,
	"activated_at" timestamp with time zone,
	CONSTRAINT "board_members_role_check" CHECK ("board_members"."role" in ('VIEW', 'EDIT')),
	CONSTRAINT "board_members_status_check" CHECK ("board_members"."status" in ('PENDING', 'ACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "board_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "share_links" (
	"token" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "share_links_boardId_unique" UNIQUE("board_id"),
	CONSTRAINT "share_links_role_check" CHECK ("share_links"."role" in ('VIEW', 'EDIT'))
);
--> statement-breakpoint
ALTER TABLE "share_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whiteboards" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"assistant_disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whiteboards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "note_history" (
	"id" text PRIMARY KEY NOT NULL,
	"note_id" text NOT NULL,
	"type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"actor_id" text,
	"metadata" jsonb,
	CONSTRAINT "note_history_type_check" CHECK ("note_history"."type" in ('CREATED', 'MOVED'))
);
--> statement-breakpoint
ALTER TABLE "note_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"board_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"completed_at" timestamp with time zone,
	"priority" text NOT NULL,
	"horizon" text NOT NULL,
	"free_x" double precision NOT NULL,
	"free_y" double precision NOT NULL,
	"due_date" date,
	"assignee_id" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"links" text[] DEFAULT '{}' NOT NULL,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"colour" text NOT NULL,
	"visibility" text DEFAULT 'SHARED' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "notes_status_check" CHECK ("notes"."status" in ('OPEN', 'DONE')),
	CONSTRAINT "notes_priority_check" CHECK ("notes"."priority" in ('HIGH', 'MEDIUM', 'LOW')),
	CONSTRAINT "notes_horizon_check" CHECK ("notes"."horizon" in ('TODAY', 'THIS_WEEK', 'LATER')),
	CONSTRAINT "notes_colour_check" CHECK ("notes"."colour" in ('CHALK', 'ICE', 'STONE', 'MINT', 'SKY', 'MIST', 'OAT', 'CLAY', 'ROSE', 'MALLOW', 'HEATHER', 'SEA_GREEN', 'SAGE', 'OLIVE')),
	CONSTRAINT "notes_visibility_check" CHECK ("notes"."visibility" in ('SHARED', 'PRIVATE')),
	CONSTRAINT "notes_private_is_authors_check" CHECK ("notes"."visibility" <> 'PRIVATE' or ("notes"."created_by_id" is not null and "notes"."assignee_id" = "notes"."created_by_id"))
);
--> statement-breakpoint
ALTER TABLE "notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subtasks" (
	"id" text PRIMARY KEY NOT NULL,
	"note_id" text NOT NULL,
	"text" text NOT NULL,
	"done" boolean NOT NULL,
	"sort_index" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subtasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant_audit" (
	"operation_id" text PRIMARY KEY NOT NULL,
	"actor_id" text NOT NULL,
	"board_id" text NOT NULL,
	"target_id" text,
	"command_type" text NOT NULL,
	"conversation_id" text,
	"approval_id" text,
	"via" text,
	"connection_id" text,
	"revision" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_audit" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "board_cleanup" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"board_id" text NOT NULL,
	"note_id" text,
	"user_id" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "board_cleanup_kind_check" CHECK ("board_cleanup"."kind" in ('note.delete', 'board.delete', 'member.remove'))
);
--> statement-breakpoint
ALTER TABLE "board_cleanup" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "board_operations" (
	"user_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"board_id" text NOT NULL,
	"roles" text[] NOT NULL,
	"result" jsonb NOT NULL,
	"provenance" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "board_operations_user_id_operation_id_pk" PRIMARY KEY("user_id","operation_id")
);
--> statement-breakpoint
ALTER TABLE "board_operations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"month" text NOT NULL,
	"reserved_tokens" integer NOT NULL,
	"reserved_micro_usd" bigint NOT NULL,
	"input_micro_usd_per_token" double precision NOT NULL,
	"output_micro_usd_per_token" double precision NOT NULL,
	"state" text NOT NULL,
	"settled_tokens" integer,
	"settled_micro_usd" bigint,
	"created_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"abandoned_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_attempts_state_check" CHECK ("assistant_attempts"."state" in ('RESERVED', 'SETTLED', 'ABANDONED'))
);
--> statement-breakpoint
ALTER TABLE "assistant_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"board_id" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"turns" integer NOT NULL,
	"messages" jsonb NOT NULL,
	"entries" jsonb NOT NULL,
	"usage" jsonb NOT NULL,
	"tool_calls" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_turn_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_conversations_status_check" CHECK ("assistant_conversations"."status" in ('OPEN', 'CLOSED'))
);
--> statement-breakpoint
ALTER TABLE "assistant_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant_spend" (
	"month" text PRIMARY KEY NOT NULL,
	"micro_usd" bigint NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_spend" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant_suggestions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"board_id" text NOT NULL,
	"note_id" text NOT NULL,
	"base_revision" integer NOT NULL,
	"base_title" text,
	"fields" jsonb NOT NULL,
	"typed" text[],
	"operation_ids" jsonb NOT NULL,
	"status" text NOT NULL,
	"decision" jsonb,
	"undone" jsonb,
	"applied" jsonb,
	"model" text NOT NULL,
	"usage" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_suggestions_status_check" CHECK ("assistant_suggestions"."status" in ('PENDING', 'KEPT', 'UNDONE', 'DISCARDED'))
);
--> statement-breakpoint
ALTER TABLE "assistant_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant_tidies" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"board_id" text NOT NULL,
	"status" text NOT NULL,
	"moves" jsonb NOT NULL,
	"decision" jsonb,
	"undone" jsonb,
	"applied" jsonb,
	"model" text,
	"usage" jsonb,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_tidies_status_check" CHECK ("assistant_tidies"."status" in ('PENDING', 'KEPT', 'UNDONE', 'DISCARDED'))
);
--> statement-breakpoint
ALTER TABLE "assistant_tidies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "assistant_usage" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"tokens" integer NOT NULL,
	"in_flight" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assistant_usage_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
ALTER TABLE "assistant_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_connections" ADD CONSTRAINT "mcp_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_limits" ADD CONSTRAINT "mcp_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_board_id_whiteboards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."whiteboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_board_id_whiteboards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."whiteboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whiteboards" ADD CONSTRAINT "whiteboards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_history" ADD CONSTRAINT "note_history_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_board_id_whiteboards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."whiteboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subtasks" ADD CONSTRAINT "subtasks_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_operations" ADD CONSTRAINT "board_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_attempts" ADD CONSTRAINT "assistant_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_suggestions" ADD CONSTRAINT "assistant_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_tidies" ADD CONSTRAINT "assistant_tidies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_usage" ADD CONSTRAINT "assistant_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_identities_user_id_index" ON "auth_identities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_connections_one_active_per_client" ON "mcp_connections" USING btree ("user_id","client_id") WHERE "mcp_connections"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "users_email_index" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "board_members_board_id_user_id_index" ON "board_members" USING btree ("board_id","user_id");--> statement-breakpoint
CREATE INDEX "board_members_invited_email_index" ON "board_members" USING btree ("invited_email");--> statement-breakpoint
CREATE INDEX "whiteboards_owner_id_index" ON "whiteboards" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "note_history_note_id_occurred_at_index" ON "note_history" USING btree ("note_id","occurred_at");--> statement-breakpoint
CREATE INDEX "notes_board_id_index" ON "notes" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "notes_board_id_assignee_id_index" ON "notes" USING btree ("board_id","assignee_id");--> statement-breakpoint
CREATE INDEX "subtasks_note_id_sort_index_index" ON "subtasks" USING btree ("note_id","sort_index");--> statement-breakpoint
CREATE INDEX "assistant_audit_expires_at_index" ON "assistant_audit" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "board_operations_expires_at_index" ON "board_operations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "assistant_attempts_user_id_index" ON "assistant_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "assistant_attempts_expires_at_index" ON "assistant_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "assistant_conversations_user_id_board_id_index" ON "assistant_conversations" USING btree ("user_id","board_id");--> statement-breakpoint
CREATE INDEX "assistant_conversations_expires_at_index" ON "assistant_conversations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "assistant_suggestions_user_id_note_id_index" ON "assistant_suggestions" USING btree ("user_id","note_id");--> statement-breakpoint
CREATE INDEX "assistant_suggestions_expires_at_index" ON "assistant_suggestions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "assistant_tidies_user_id_board_id_index" ON "assistant_tidies" USING btree ("user_id","board_id");--> statement-breakpoint
CREATE INDEX "assistant_tidies_expires_at_index" ON "assistant_tidies" USING btree ("expires_at");