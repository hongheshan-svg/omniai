import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const db = drizzle(sql);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required to run migrations");
    process.exit(1);
  }
  await runMigrations(databaseUrl);
  console.log("Migrations applied");
}
