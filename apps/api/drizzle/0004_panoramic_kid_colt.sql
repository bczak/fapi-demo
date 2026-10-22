ALTER TABLE `orders` ADD `request_hash` text;--> statement-breakpoint
CREATE INDEX `orders_created_at_idx` ON `orders` (`created_at`);