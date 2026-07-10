ALTER TABLE `summary_entries` ADD `notebooklm_links` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE `summary_entries`
SET `notebooklm_links` = (
  SELECT json_array(
    json_object(
      'url', `summary_entries`.`notebooklm_url`,
      'title', COALESCE(
        (SELECT `title` FROM `notebooks` WHERE `url` = `summary_entries`.`notebooklm_url` LIMIT 1),
        'NotebookLM'
      )
    )
  )
)
WHERE `notebooklm_url` IS NOT NULL AND length(`notebooklm_url`) > 0;
