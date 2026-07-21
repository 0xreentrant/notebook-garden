CREATE TABLE `meta_analyses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`content` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`created_at` text NOT NULL
);
