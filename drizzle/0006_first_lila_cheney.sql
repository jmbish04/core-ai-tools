PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_revisions` (
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
	FOREIGN KEY (`output_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ck_revisions_real_edit_has_model" CHECK("__new_revisions"."parent_revision_id" is null or ("__new_revisions"."edit_payload" is not null and "__new_revisions"."requested_model" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_revisions`("id", "session_uuid", "parent_revision_id", "attempt_number", "edit_fingerprint", "status", "prompt_text", "edit_payload", "blueprint", "mask_id", "mask_mode", "mask_emulated", "requested_model", "served_model", "provider", "fallback_reason", "input_image_id", "output_image_id", "error_code", "error_message", "latency_ms", "token_usage", "cost_estimate", "created_via", "is_pinned", "approval_required", "approved_by_surface", "approved_at", "rejection_reason", "approval_expires_at", "created_at") SELECT "id", "session_uuid", "parent_revision_id", "attempt_number", "edit_fingerprint", "status", "prompt_text", "edit_payload", "blueprint", "mask_id", "mask_mode", "mask_emulated", "requested_model", "served_model", "provider", "fallback_reason", "input_image_id", "output_image_id", "error_code", "error_message", "latency_ms", "token_usage", "cost_estimate", "created_via", "is_pinned", "approval_required", "approved_by_surface", "approved_at", "rejection_reason", "approval_expires_at", "created_at" FROM `revisions`;--> statement-breakpoint
DROP TABLE `revisions`;--> statement-breakpoint
ALTER TABLE `__new_revisions` RENAME TO `revisions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_revisions_retry` ON `revisions` (`session_uuid`,`parent_revision_id`,`edit_fingerprint`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `idx_revisions_expiry` ON `revisions` (`status`,`approval_expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_revisions_root_per_session` ON `revisions` (`session_uuid`) WHERE "revisions"."parent_revision_id" is null;