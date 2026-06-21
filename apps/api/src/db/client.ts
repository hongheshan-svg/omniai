import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type AppDatabase = PostgresJsDatabase<typeof schema>;

export interface DbClient {
  db: AppDatabase;
  verifyConnectivity(): Promise<void>;
  close(): Promise<void>;
}

// `prepare: false` is required when connecting through the Supabase transaction
// pooler (port 6543); it is harmless on a direct connection (port 5432).
export function createDbClient(databaseUrl: string): DbClient {
  const sql = postgres(databaseUrl, { prepare: false });
  const db = drizzle(sql, { schema });

  return {
    db,
    async verifyConnectivity() {
      await sql`select 1`;
    },
    async close() {
      await sql.end({ timeout: 5 });
    }
  };
}
