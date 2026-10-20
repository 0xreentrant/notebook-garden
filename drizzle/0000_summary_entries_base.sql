CREATE TABLE `summary_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_id` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`status` text NOT NULL,
	`skip_backfill` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`summary_text` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `summary_entries_video_id_unique` ON `summary_entries` (`video_id`);
