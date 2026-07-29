CREATE TABLE `revision_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`kind` text NOT NULL,
	`cf_image_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `model_catalog` (
	`model_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`display_name` text NOT NULL,
	`capabilities` text NOT NULL,
	`max_resolution` text,
	`supported_aspect_ratios` text,
	`cost_per_image` real,
	`is_new` integer DEFAULT false NOT NULL,
	`deprecated_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `task_model_defaults` (
	`task_key` text PRIMARY KEY NOT NULL,
	`model_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_by_surface` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`model_id`) REFERENCES `model_catalog`(`model_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `model_overrides` text;--> statement-breakpoint
ALTER TABLE `revisions` ADD `provider_interaction_id` text;--> statement-breakpoint
ALTER TABLE `revisions` ADD `provider_conversation_lost` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `revisions` ADD `grounding_search_suggestions` text;--> statement-breakpoint
ALTER TABLE `revisions` ADD `grounding_citations` text;--> statement-breakpoint
ALTER TABLE `revisions` ADD `served_via` text;