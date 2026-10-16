-- =====================================================================
-- AFRISTOCK - BASE DE DONNÉES MYSQL COMPLETE (LARAGON)
-- Multi-utilisateurs / Multi-vendeurs + Panel Administrateur
-- Hashage sécurisé Scrypt / PBKDF2 + Gestion des mots de passe
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `afristock`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `afristock`;

-- 1. TABLE UTILISATEURS (ADMIN & VENDEURS)
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL,
  `username` VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  `email` VARCHAR(254) COLLATE utf8mb4_bin NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `role` ENUM('admin', 'seller') NOT NULL DEFAULT 'seller',
  `status` ENUM('active', 'inactive', 'suspended') NOT NULL DEFAULT 'active',
  `first_name` VARCHAR(128) DEFAULT NULL,
  `last_name` VARCHAR(128) DEFAULT NULL,
  `phone` VARCHAR(64) DEFAULT NULL,
  `shop_name` VARCHAR(254) DEFAULT 'AfriStock',
  `logo` LONGTEXT DEFAULT NULL,
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0,
  `google_id` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `users_username_unique` (`username`),
  UNIQUE KEY `users_email_unique` (`email`),
  KEY `users_role_idx` (`role`),
  KEY `users_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. TABLE SESSIONS UTILISATEUR (express-mysql-session)
CREATE TABLE IF NOT EXISTS `user_sessions` (
  `session_id` VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  `expires` INT(11) UNSIGNED NOT NULL,
  `data` MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- 3. TABLE PARAMÈTRES GLOBAUX
CREATE TABLE IF NOT EXISTS `app_settings` (
  `key` VARCHAR(191) NOT NULL,
  `value` LONGTEXT DEFAULT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. TABLE CATÉGORIES (GLOBALES OU LIÉES À UN VENDEUR)
CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(191) NOT NULL,
  `family` VARCHAR(191) NOT NULL DEFAULT 'autres',
  `user_id` INT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `categories_user_name_unique` (`user_id`, `name`),
  KEY `categories_family_idx` (`family`),
  KEY `categories_user_idx` (`user_id`),
  CONSTRAINT `categories_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. TABLE PRODUITS (LIÉS DIRECTEMENT À CHAQUE VENDEUR / UTILISATEUR)
CREATE TABLE IF NOT EXISTS `products` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `category` VARCHAR(191) NOT NULL,
  `brand` VARCHAR(191) NOT NULL,
  `model` VARCHAR(191) NOT NULL,
  `reference` VARCHAR(191) DEFAULT NULL,
  `quantity` INT NOT NULL DEFAULT 0,
  `price_buy` INT NOT NULL DEFAULT 0,
  `price_sale` INT NOT NULL DEFAULT 0,
  `threshold` INT NOT NULL DEFAULT 3,
  `location` VARCHAR(255) DEFAULT NULL,
  `description` TEXT DEFAULT NULL,
  `compatible_models` TEXT DEFAULT NULL,
  `date_created` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `products_user_idx` (`user_id`),
  KEY `products_category_idx` (`category`),
  KEY `products_quantity_idx` (`quantity`),
  KEY `products_brand_idx` (`brand`),
  CONSTRAINT `products_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. TABLE VENTES (LIÉES AU VENDEUR)
CREATE TABLE IF NOT EXISTS `sales` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `sale_date` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `total_amount` INT NOT NULL DEFAULT 0,
  `total_profit` INT NOT NULL DEFAULT 0,
  `items_count` INT NOT NULL DEFAULT 0,
  `customer_name` VARCHAR(255) DEFAULT NULL,
  `payment_method` VARCHAR(64) DEFAULT 'cash',
  PRIMARY KEY (`id`),
  KEY `sales_user_idx` (`user_id`),
  KEY `sales_date_idx` (`sale_date`),
  CONSTRAINT `sales_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. TABLE LIGNES DE VENTE
CREATE TABLE IF NOT EXISTS `sale_items` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `sale_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `quantity` INT NOT NULL,
  `unit_price` INT NOT NULL,
  `subtotal` INT NOT NULL,
  `profit` INT NOT NULL,
  PRIMARY KEY (`id`),
  KEY `sale_items_sale_idx` (`sale_id`),
  KEY `sale_items_product_idx` (`product_id`),
  CONSTRAINT `sale_items_sale_fk` FOREIGN KEY (`sale_id`) REFERENCES `sales` (`id`) ON DELETE CASCADE,
  CONSTRAINT `sale_items_product_fk` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. TABLE MOUVEMENTS DE STOCK (TRACABILITÉ COMPLÈTE)
CREATE TABLE IF NOT EXISTS `stock_movements` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `product_id` INT NOT NULL,
  `type` VARCHAR(64) NOT NULL, -- 'entry', 'sale', 'adjustment', 'return'
  `quantity` INT NOT NULL,
  `note` TEXT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `stock_movements_user_idx` (`user_id`),
  KEY `stock_movements_product_idx` (`product_id`),
  KEY `stock_movements_created_idx` (`created_at`),
  CONSTRAINT `stock_movements_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `stock_movements_product_fk` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. TABLE RÉINITIALISATIONS / HISTORIQUE DE MOT DE PASSE
CREATE TABLE IF NOT EXISTS `password_resets` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `token` VARCHAR(255) NOT NULL,
  `temp_password` VARCHAR(255) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `expires_at` DATETIME NOT NULL,
  `used` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `password_resets_user_idx` (`user_id`),
  KEY `password_resets_token_idx` (`token`),
  CONSTRAINT `password_resets_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. TABLE JOURNAL D'ACTIVITÉ & ENREGISTREMENT DIRECT DES MODIFICATIONS
CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT DEFAULT NULL,
  `user_name` VARCHAR(255) DEFAULT NULL,
  `action` VARCHAR(64) NOT NULL, -- 'PRODUCT_CREATE', 'PRODUCT_UPDATE', 'PRODUCT_DELETE', 'STOCK_ENTRY', 'SALE_COMPLETED', 'USER_UPDATE', 'PASSWORD_RESET', etc.
  `entity_type` VARCHAR(64) NOT NULL, -- 'product', 'sale', 'user', 'category', 'profile'
  `entity_id` INT DEFAULT NULL,
  `description` TEXT NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `activity_logs_user_idx` (`user_id`),
  KEY `activity_logs_action_idx` (`action`),
  KEY `activity_logs_created_idx` (`created_at`),
  CONSTRAINT `activity_logs_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- 11. INITIALISATION DU COMPTE ADMINISTRATEUR
-- =====================================================================
-- Le propriétaire initial est créé par le formulaire de première installation.
