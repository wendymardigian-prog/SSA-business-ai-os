#!/usr/bin/env node
/**
 * Regenerates supabase/migrations/ALL_MIGRATIONS.sql from the numbered
 * migration files.
 *
 * The bundle is the paste-into-the-SQL-editor convenience copy, and
 * lib/platforms.test.ts pins it to be a faithful in-order copy of every
 * migration. Hand-editing a migration without regenerating the bundle breaks
 * that test (it did: the uuid_generate_v4 -> gen_random_uuid fix touched the
 * files only). Run this after adding or editing any migration.
 *
 *   node scripts/build-all-migrations.mjs
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const BUNDLE = "ALL_MIGRATIONS.sql";

const HEADER = `-- =============================================
-- ZERNFLOW - COMBINED MIGRATIONS
-- Generated from supabase/migrations/*.sql, in order.
-- DO NOT EDIT BY HAND: run \`node scripts/build-all-migrations.mjs\`
-- Paste this entire file into Supabase SQL Editor
-- https://supabase.com/dashboard/project/_/sql/new
-- =============================================
`;

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort();

const sections = files.map((file) => {
  const number = Number(file.slice(0, 5));
  const title = file.replace(/^\d+_/, "").replace(/\.sql$/, "").replace(/_/g, " ").toUpperCase();
  const body = readFileSync(join(MIGRATIONS_DIR, file), "utf8").trim();
  return [
    "-- ============================================================",
    `-- MIGRATION ${number}: ${title}`,
    "-- ============================================================",
    body,
  ].join("\n");
});

writeFileSync(join(MIGRATIONS_DIR, BUNDLE), `${HEADER}\n${sections.join("\n\n")}\n`);
console.log(`${BUNDLE}: ${files.length} migrations bundled`);
