CREATE TABLE "assets" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text,
	"mode" text NOT NULL,
	"title" text NOT NULL,
	"content" jsonb NOT NULL,
	"preview" jsonb NOT NULL,
	"source" jsonb NOT NULL,
	"prompt" text NOT NULL,
	"optimized_prompt" text NOT NULL,
	"preset" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"prompt" text NOT NULL,
	"optimized_prompt" text NOT NULL,
	"preset" jsonb NOT NULL,
	"result_preview" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"destination" text NOT NULL,
	"channel" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"destination" text NOT NULL,
	"channel" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_tasks" ADD CONSTRAINT "generation_tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_owner_created_idx" ON "assets" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_tasks_owner_created_idx" ON "generation_tasks" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "login_challenges_expires_at_idx" ON "login_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_channel_destination_key" ON "users" USING btree ("channel","destination");