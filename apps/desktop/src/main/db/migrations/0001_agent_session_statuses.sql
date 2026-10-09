PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`exit_code` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_agent_sessions`("id", "agent_id", "workspace_id", "status", "exit_code", "started_at", "ended_at") SELECT "id", "agent_id", "workspace_id", "status", "exit_code", "started_at", "ended_at" FROM `agent_sessions`;--> statement-breakpoint
DROP TABLE `agent_sessions`;--> statement-breakpoint
ALTER TABLE `__new_agent_sessions` RENAME TO `agent_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `agent_sessions_agent_id_idx` ON `agent_sessions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_workspace_id_idx` ON `agent_sessions` (`workspace_id`);