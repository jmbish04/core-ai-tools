CREATE TABLE `model_run_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`requested_model` text NOT NULL,
	`served_model` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`prompt_sent` text NOT NULL,
	`mask_sent` integer DEFAULT false NOT NULL,
	`output_image_id` text,
	`latency_ms` integer,
	`cost_usd` real,
	`tokens_in` integer,
	`tokens_out` integer,
	`tokens_thinking` integer,
	`error_code` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `model_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`output_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_model_run_results_model` ON `model_run_results` (`run_id`,`requested_model`);--> statement-breakpoint
CREATE TABLE `model_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`input_image_id` text,
	`mask_id` text,
	`requested_models` text NOT NULL,
	`folder_id` text,
	`context_text` text,
	`created_via` text DEFAULT 'api' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`input_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`mask_id`) REFERENCES `masks`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_model_runs_folder` ON `model_runs` (`folder_id`);--> statement-breakpoint
CREATE INDEX `idx_model_runs_created` ON `model_runs` (`created_at`);