CREATE TABLE `understanding_results` (
	`id` text PRIMARY KEY NOT NULL,
	`source_image_id` text NOT NULL,
	`kind` text NOT NULL,
	`query` text,
	`result` text,
	`model` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_image_id`) REFERENCES `library_images`(`id`) ON UPDATE no action ON DELETE cascade
);
