CREATE TABLE `bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`folder_path` text DEFAULT '' NOT NULL,
	`chrome_profile` text NOT NULL,
	`notebooklm_url` text,
	`notebooklm_links` text DEFAULT '[]' NOT NULL,
	`last_viewed` text,
	`pinned` integer DEFAULT 0 NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarks_url_unique` ON `bookmarks` (`url`);
