-- Athenaeum Cloudflare D1 schema; already provisioned in Sara Jane's Cloudflare account.
-- Bind the D1 database as DB to a Pages Worker only after Cloudflare Access is enabled.
-- Every account API must verify Access JWT; never trust a browser-supplied email.
CREATE TABLE IF NOT EXISTS members(email TEXT PRIMARY KEY COLLATE NOCASE, display_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reading_progress(email TEXT NOT NULL COLLATE NOCASE REFERENCES members(email), book_id TEXT NOT NULL, locator TEXT, page INTEGER, percentage REAL NOT NULL DEFAULT 0 CHECK(percentage >= 0 AND percentage <= 100), updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(email,book_id));
CREATE TABLE IF NOT EXISTS saved_books(email TEXT NOT NULL COLLATE NOCASE REFERENCES members(email), book_id TEXT NOT NULL, added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(email,book_id));
CREATE TABLE IF NOT EXISTS recommendations(id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE REFERENCES members(email), book_id TEXT, suggested_title TEXT NOT NULL, suggested_author TEXT, comment TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE REFERENCES members(email), book_id TEXT NOT NULL, body TEXT NOT NULL CHECK(length(body) <= 20000), page_label TEXT, is_shared INTEGER NOT NULL DEFAULT 0 CHECK(is_shared IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_notes_book_shared ON notes(book_id,is_shared,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recs_created ON recommendations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(email,updated_at DESC);
