PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mcp_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`server_name` text NOT NULL,
	`tool_name` text NOT NULL,
	`request` text,
	`response` text,
	`success` integer,
	`error_message` text,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`session_uuid` text,
	`revision_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_mcp_logs`("id", "server_name", "tool_name", "request", "response", "success", "error_message", "latency_ms", "created_at") SELECT "id", "server_name", "tool_name", "request", "response", "success", "error_message", "latency_ms", "created_at" FROM `mcp_logs`;--> statement-breakpoint
DROP TABLE `mcp_logs`;--> statement-breakpoint
ALTER TABLE `__new_mcp_logs` RENAME TO `mcp_logs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `mcp_logs_session_created_idx` ON `mcp_logs` (`session_uuid`,`created_at`);--> statement-breakpoint
CREATE INDEX `mcp_logs_created_idx` ON `mcp_logs` (`created_at`);