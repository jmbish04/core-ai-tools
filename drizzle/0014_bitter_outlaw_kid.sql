CREATE TABLE `session_images` (
	`id` text PRIMARY KEY NOT NULL,
	`session_uuid` text NOT NULL,
	`library_image_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_uuid`) REFERENCES `sessions`(`session_uuid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`library_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_session_images` ON `session_images` (`session_uuid`,`library_image_id`);--> statement-breakpoint
CREATE INDEX `idx_session_images_session` ON `session_images` (`session_uuid`);--> statement-breakpoint
ALTER TABLE `library_images` ADD `description` text;--> statement-breakpoint
ALTER TABLE `library_images` ADD `flagged_bad_at` integer;--> statement-breakpoint
ALTER TABLE `library_images` ADD `bad_notes` text;