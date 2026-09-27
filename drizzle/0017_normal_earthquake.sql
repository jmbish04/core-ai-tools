ALTER TABLE `library_folders` ADD `archived_at` integer;--> statement-breakpoint
CREATE INDEX `idx_library_folders_archived` ON `library_folders` (`archived_at`);