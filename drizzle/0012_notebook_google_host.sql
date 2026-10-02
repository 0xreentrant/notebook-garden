UPDATE `notebooks`
SET `url` = REPLACE(`url`, 'https://notebooklm.google.com', 'https://notebook.google.com')
WHERE `url` LIKE 'https://notebooklm.google.com%';
--> statement-breakpoint
UPDATE `summary_entries`
SET `notebooklm_url` = REPLACE(`notebooklm_url`, 'https://notebooklm.google.com', 'https://notebook.google.com')
WHERE `notebooklm_url` LIKE 'https://notebooklm.google.com%';
--> statement-breakpoint
UPDATE `summary_entries`
SET `notebooklm_links` = REPLACE(`notebooklm_links`, 'https://notebooklm.google.com', 'https://notebook.google.com')
WHERE `notebooklm_links` LIKE '%https://notebooklm.google.com%';
--> statement-breakpoint
UPDATE `bookmarks`
SET `notebooklm_url` = REPLACE(`notebooklm_url`, 'https://notebooklm.google.com', 'https://notebook.google.com')
WHERE `notebooklm_url` LIKE 'https://notebooklm.google.com%';
--> statement-breakpoint
UPDATE `bookmarks`
SET `notebooklm_links` = REPLACE(`notebooklm_links`, 'https://notebooklm.google.com', 'https://notebook.google.com')
WHERE `notebooklm_links` LIKE '%https://notebooklm.google.com%';
--> statement-breakpoint
UPDATE `linkedin_saved_items`
SET `notebooklm_url` = REPLACE(`notebooklm_url`, 'https://notebooklm.google.com', 'https://notebook.google.com')
WHERE `notebooklm_url` LIKE 'https://notebooklm.google.com%';
--> statement-breakpoint
UPDATE `linkedin_saved_items`
SET `notebooklm_links` = REPLACE(`notebooklm_links`, 'https://notebooklm.google.com', 'https://notebook.google.com')
WHERE `notebooklm_links` LIKE '%https://notebooklm.google.com%';
