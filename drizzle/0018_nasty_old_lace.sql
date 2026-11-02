CREATE TABLE IF NOT EXISTS `cocreate_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`goal` text,
	`current_prompt` text DEFAULT '' NOT NULL,
	`current_version_id` text,
	`belief_graph` text,
	`proactiveness` text DEFAULT 'medium' NOT NULL,
	`aspect_ratio` text DEFAULT '16:9' NOT NULL,
	`image_model` text,
	`reference_image_id` text,
	`folder_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`reference_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cocreate_sessions_updated` ON `cocreate_sessions` (`archived_at`,`updated_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cocreate_prompt_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`version` integer NOT NULL,
	`parent_version_id` text,
	`prompt_text` text NOT NULL,
	`source` text NOT NULL,
	`graph_updates` text,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `cocreate_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_version_id`) REFERENCES `cocreate_prompt_versions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uniq_cocreate_versions_session_version` ON `cocreate_prompt_versions` (`session_id`,`version`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cocreate_versions_parent` ON `cocreate_prompt_versions` (`parent_version_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cocreate_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`asked_in_version_id` text,
	`applied_in_version_id` text,
	`question` text NOT NULL,
	`options` text NOT NULL,
	`answer` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_answer_id` text,
	`created_at` integer NOT NULL,
	`answered_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `cocreate_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`asked_in_version_id`) REFERENCES `cocreate_prompt_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`applied_in_version_id`) REFERENCES `cocreate_prompt_versions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_answer_id`) REFERENCES `cocreate_answers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cocreate_answers_session` ON `cocreate_answers` (`session_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cocreate_answers_status_answered` ON `cocreate_answers` (`status`,`answered_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cocreate_answers_source` ON `cocreate_answers` (`source_answer_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cocreate_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`prompt_version_id` text NOT NULL,
	`library_image_id` text,
	`batch_id` text NOT NULL,
	`model` text NOT NULL,
	`aspect_ratio` text,
	`error` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `cocreate_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`prompt_version_id`) REFERENCES `cocreate_prompt_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`library_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cocreate_generations_session` ON `cocreate_generations` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cocreate_generations_version` ON `cocreate_generations` (`prompt_version_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cocreate_generations_image` ON `cocreate_generations` (`library_image_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cocreate_consultation_matches` (
	`consultation_id` text NOT NULL,
	`answer_id` text NOT NULL,
	`reason` text NOT NULL,
	`how_to_use` text NOT NULL,
	PRIMARY KEY(`consultation_id`, `answer_id`),
	FOREIGN KEY (`consultation_id`) REFERENCES `cocreate_consultations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`answer_id`) REFERENCES `cocreate_answers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cocreate_matches_answer` ON `cocreate_consultation_matches` (`answer_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `cocreate_consultations` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text,
	`goal` text NOT NULL,
	`advice` text NOT NULL,
	`model` text NOT NULL,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `cocreate_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_cocreate_consultations_session` ON `cocreate_consultations` (`session_id`,`created_at`);