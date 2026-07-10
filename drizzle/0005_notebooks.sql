CREATE TABLE `notebooks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notebooklm_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`last_viewed` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`source_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notebooks_notebooklm_id_unique` ON `notebooks` (`notebooklm_id`);
