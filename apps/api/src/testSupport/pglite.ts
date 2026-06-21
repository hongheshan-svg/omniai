import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { AppDatabase } from "../db/client";
import * as schema from "../db/schema";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

export interface PgliteDatabase {
  db: AppDatabase;
  close(): Promise<void>;
}

export async function createPgliteDatabase(): Promise<PgliteDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return {
    // The pglite and postgres-js drizzle instances expose the same query API at
    // runtime; the cast lets repositories type against a single AppDatabase.
    db: db as unknown as AppDatabase,
    async close() {
      await client.close();
    }
  };
}
