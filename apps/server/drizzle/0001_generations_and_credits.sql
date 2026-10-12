CREATE TABLE "credit_balance" (
	"user_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_balance_non_negative" CHECK ("credit_balance"."balance" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"job_id" text,
	"generation_id" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "credit_ledger_reason_check" CHECK ("credit_ledger"."reason" in ('grant', 'reserve', 'refund', 'adjust'))
);
--> statement-breakpoint
CREATE TABLE "generation" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"source_image_id" text,
	"parent_generation_id" text,
	"prompt" text DEFAULT '' NOT NULL,
	"category" jsonb,
	"settings" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "generation_kind_check" CHECK ("generation"."kind" in ('images', 'copy')),
	CONSTRAINT "generation_status_check" CHECK ("generation"."status" in ('active', 'completed', 'partial', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "generation_job" (
	"id" text PRIMARY KEY NOT NULL,
	"generation_id" text NOT NULL,
	"listing_id" text NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"index" integer NOT NULL,
	"source_image_id" text,
	"prompt" text NOT NULL,
	"shot_id" text,
	"shot_label" jsonb,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"aspect_ratio" text DEFAULT 'original' NOT NULL,
	"image_size" text,
	"provider_options" jsonb,
	"seed" integer,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"credits" integer NOT NULL,
	"result_image_id" text,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "generation_job_status_check" CHECK ("generation_job"."status" in ('queued', 'dispatched', 'active', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "generation_job_credits_check" CHECK ("generation_job"."credits" >= 0)
);
--> statement-breakpoint
ALTER TABLE "credit_balance" ADD CONSTRAINT "credit_balance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_listing_id_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation" ADD CONSTRAINT "generation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_generation_id_generation_id_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."generation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_listing_id_listing_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_job" ADD CONSTRAINT "generation_job_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_ledger_user_idx" ON "credit_ledger" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "generation_listing_idx" ON "generation" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "generation_job_user_status_idx" ON "generation_job" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE INDEX "generation_job_status_dispatched_idx" ON "generation_job" USING btree ("status","dispatched_at");--> statement-breakpoint
CREATE INDEX "generation_job_generation_idx" ON "generation_job" USING btree ("generation_id");