CREATE TABLE `prompt_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`template_body` text NOT NULL,
	`example_prompt` text,
	`recommended_model` text,
	`recommended_settings` text,
	`technique_tags` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`promoted_from_revision_id` text,
	`use_count` integer DEFAULT 0 NOT NULL,
	`avg_grade` real,
	`created_via` text DEFAULT 'ui' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE TABLE `prompt_grades` (
	`id` text PRIMARY KEY NOT NULL,
	`revision_id` text NOT NULL,
	`template_id` text,
	`grade` integer NOT NULL,
	`graded_by_surface` text,
	`failure_mode` text,
	`notes` text,
	`suggested_revision` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `library_images` ADD `media_type` text DEFAULT 'image' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_images` ADD `storage` text DEFAULT 'cf_images' NOT NULL;--> statement-breakpoint
ALTER TABLE `library_images` ADD `r2_key` text;--> statement-breakpoint
ALTER TABLE `library_images` ADD `duration_ms` integer;--> statement-breakpoint
ALTER TABLE `library_images` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `library_images` ADD `ttl_days` integer;--> statement-breakpoint
ALTER TABLE `library_images` ADD `ttl_set_by_surface` text;--> statement-breakpoint
ALTER TABLE `library_images` ADD `ttl_updated_at` integer;--> statement-breakpoint
ALTER TABLE `library_images` ADD `bytes_purged_at` integer;--> statement-breakpoint
CREATE INDEX `idx_library_images_expiry` ON `library_images` (`expires_at`) WHERE "library_images"."bytes_purged_at" is null and "library_images"."expires_at" is not null;