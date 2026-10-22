ALTER TABLE `orders` ADD `payment_currency` text DEFAULT 'CZK' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `exchange_rate` real DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `exchange_rate_date` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `payment_total_minor` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Orders placed before payment currencies existed were all in CZK.
UPDATE `orders` SET `payment_total_minor` = `total_minor`;
