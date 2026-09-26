CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`library_image_id` text NOT NULL,
	`promoted_from_image_id` text,
	`description` text,
	`usage_instructions` text,
	`context_text` text,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`library_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`promoted_from_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_assets_library_image` ON `assets` (`library_image_id`);--> statement-breakpoint
CREATE INDEX `idx_assets_promoted_from` ON `assets` (`promoted_from_image_id`);--> statement-breakpoint
CREATE TABLE `asset_lineage` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`library_image_id` text NOT NULL,
	`session_uuid` text,
	`revision_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`library_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_uuid`) REFERENCES `sessions`(`session_uuid`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_asset_lineage` ON `asset_lineage` (`asset_id`,`library_image_id`);--> statement-breakpoint
CREATE INDEX `idx_asset_lineage_asset_created` ON `asset_lineage` (`asset_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_asset_lineage_image` ON `asset_lineage` (`library_image_id`);--> statement-breakpoint
ALTER TABLE `library_folders` ADD `default_prompt` text;--> statement-breakpoint
ALTER TABLE `library_folders` ADD `context_text` text;--> statement-breakpoint
ALTER TABLE `library_folders` ADD `use_case` text;--> statement-breakpoint
ALTER TABLE `library_folders` ADD `preferred_models` text;--> statement-breakpoint
ALTER TABLE `library_folders` ADD `approval_policy` text;--> statement-breakpoint
ALTER TABLE `library_images` ADD `public_id` text;--> statement-breakpoint
ALTER TABLE `library_images` ADD `title` text;--> statement-breakpoint
ALTER TABLE `library_images` ADD `usage_instructions` text;--> statement-breakpoint
ALTER TABLE `library_images` ADD `context_text` text;--> statement-breakpoint
ALTER TABLE `library_images` ADD `role` text;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_library_images_public_id` ON `library_images` (`public_id`);