ALTER TABLE `bookmarks` ADD `summary_text` text;
--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `summary_status` text DEFAULT 'pending' NOT NULL;
--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `summary_error` text;
