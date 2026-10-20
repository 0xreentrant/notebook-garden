CREATE TABLE `reddit_saved_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reddit_name` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`permalink` text NOT NULL,
	`subreddit` text DEFAULT '' NOT NULL,
	`author` text DEFAULT '' NOT NULL,
	`content_text` text,
	`over_18` integer DEFAULT 0 NOT NULL,
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
CREATE UNIQUE INDEX `reddit_saved_items_reddit_name_unique` ON `reddit_saved_items` (`reddit_name`);
