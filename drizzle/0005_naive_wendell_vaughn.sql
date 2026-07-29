CREATE TABLE `library_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_folder_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`parent_folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_library_folders_parent` ON `library_folders` (`parent_folder_id`);--> statement-breakpoint
CREATE TABLE `library_images` (
	`id` text PRIMARY KEY NOT NULL,
	`cf_image_id` text NOT NULL,
	`delivery_url` text NOT NULL,
	`folder_id` text,
	`original_filename` text,
	`content_type` text,
	`width` integer,
	`height` integer,
	`bytes` integer,
	`kind` text DEFAULT 'stock' NOT NULL,
	`uploaded_via` text DEFAULT 'ui' NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_library_images_folder` ON `library_images` (`folder_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`session_uuid` text PRIMARY KEY NOT NULL,
	`title` text,
	`origin_library_image_id` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`approval_policy` text DEFAULT 'masked_only' NOT NULL,
	`root_revision_id` text,
	`created_via` text DEFAULT 'ui' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	FOREIGN KEY (`origin_library_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_origin_image` ON `sessions` (`origin_library_image_id`);--> statement-breakpoint
CREATE TABLE `masks` (
	`id` text PRIMARY KEY NOT NULL,
	`session_uuid` text,
	`source_image_id` text NOT NULL,
	`kind` text NOT NULL,
	`geometry` text NOT NULL,
	`cf_image_id` text,
	`feather_px` integer DEFAULT 0 NOT NULL,
	`label` text,
	`state` text DEFAULT 'proposed' NOT NULL,
	`derived_from_mask_id` text,
	`coverage_ratio` real,
	`created_via` text DEFAULT 'ui' NOT NULL,
	`created_at` integer NOT NULL,
	`confirmed_at` integer,
	`deleted_at` integer,
	FOREIGN KEY (`session_uuid`) REFERENCES `sessions`(`session_uuid`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`derived_from_mask_id`) REFERENCES `masks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_masks_derived_from` ON `masks` (`derived_from_mask_id`);--> statement-breakpoint
CREATE INDEX `idx_masks_session` ON `masks` (`session_uuid`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_uuid` text NOT NULL,
	`parent_revision_id` text,
	`attempt_number` integer DEFAULT 1 NOT NULL,
	`edit_fingerprint` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`prompt_text` text NOT NULL,
	`edit_payload` text,
	`blueprint` text,
	`mask_id` text,
	`mask_mode` text DEFAULT 'none' NOT NULL,
	`mask_emulated` integer DEFAULT false NOT NULL,
	`requested_model` text,
	`served_model` text,
	`provider` text,
	`fallback_reason` text,
	`input_image_id` text NOT NULL,
	`output_image_id` text,
	`error_code` text,
	`error_message` text,
	`latency_ms` integer,
	`token_usage` text,
	`cost_estimate` real,
	`created_via` text DEFAULT 'ui' NOT NULL,
	`is_pinned` integer DEFAULT false NOT NULL,
	`approval_required` integer DEFAULT false NOT NULL,
	`approved_by_surface` text,
	`approved_at` integer,
	`rejection_reason` text,
	`approval_expires_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_uuid`) REFERENCES `sessions`(`session_uuid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`mask_id`) REFERENCES `masks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`input_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`output_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_revisions_retry` ON `revisions` (`session_uuid`,`parent_revision_id`,`edit_fingerprint`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `idx_revisions_expiry` ON `revisions` (`status`,`approval_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_revisions_root_per_session` ON `revisions` (`session_uuid`) WHERE "revisions"."parent_revision_id" is null;--> statement-breakpoint
CREATE TABLE `revision_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_uuid` text NOT NULL,
	`revision_id` text,
	`seq` integer NOT NULL,
	`event_type` text NOT NULL,
	`payload` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_uuid`) REFERENCES `sessions`(`session_uuid`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `revisions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_revision_events_session_seq` ON `revision_events` (`session_uuid`,`seq`);--> statement-breakpoint
CREATE INDEX `idx_revision_events_revision` ON `revision_events` (`revision_id`);