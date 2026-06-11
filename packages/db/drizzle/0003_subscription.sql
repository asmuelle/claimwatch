CREATE TABLE "subscription" (
	"org_id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"billing_cycle" text NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"grace_until" timestamp with time zone,
	"pending_plan_id" text,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_org_id_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."org"("id") ON DELETE no action ON UPDATE no action;