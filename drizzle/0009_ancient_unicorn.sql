CREATE TABLE `usage_outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`next_retry_at` integer,
	`created_at` integer NOT NULL
);
