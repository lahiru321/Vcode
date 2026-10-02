CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`exit_code` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_agent_id_idx` ON `agent_sessions` (`agent_id`);--> statement-breakpoint
CREATE INDEX `agent_sessions_workspace_id_idx` ON `agent_sessions` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`credential_id` text,
	`name` text NOT NULL,
	`adapter` text NOT NULL,
	`executable` text NOT NULL,
	`args_json` text DEFAULT '[]' NOT NULL,
	`env_json` text DEFAULT '{}' NOT NULL,
	`model` text,
	`role` text,
	`instructions` text,
	`status` text DEFAULT 'unvalidated' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`credential_id`) REFERENCES `credentials`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agents_project_id_idx` ON `agents` (`project_id`);--> statement-breakpoint
CREATE INDEX `agents_credential_id_idx` ON `agents` (`credential_id`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text,
	`metadata_json` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_logs_project_id_created_at_idx` ON `audit_logs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`provider` text NOT NULL,
	`auth_type` text NOT NULL,
	`encrypted_secret` blob NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_name_unique` ON `credentials` (`name`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`root_path` text NOT NULL,
	`default_branch` text,
	`layout_json` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_slug_unique` ON `projects` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `projects_root_path_unique` ON `projects` (`root_path`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`remote_url` text,
	`local_path` text NOT NULL,
	`default_branch` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repositories_project_id_idx` ON `repositories` (`project_id`);--> statement-breakpoint
CREATE TABLE `terminal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`agent_session_id` text,
	`title` text NOT NULL,
	`shell` text NOT NULL,
	`cwd` text NOT NULL,
	`pid` integer,
	`cols` integer NOT NULL,
	`rows` integer NOT NULL,
	`status` text DEFAULT 'starting' NOT NULL,
	`exit_code` integer,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_session_id`) REFERENCES `agent_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `terminal_sessions_workspace_id_idx` ON `terminal_sessions` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_agent_session_id_idx` ON `terminal_sessions` (`agent_session_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`repository_id` text,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`branch` text,
	`status` text DEFAULT 'ready' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_project_id_name_unique` ON `workspaces` (`project_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_path_unique` ON `workspaces` (`path`);--> statement-breakpoint
CREATE INDEX `workspaces_repository_id_idx` ON `workspaces` (`repository_id`);