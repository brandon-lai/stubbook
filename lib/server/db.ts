import "server-only";
import postgres from "postgres";

/** True when a database is configured. Every write path checks this and refuses cleanly when it is not. */
export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

const g = globalThis as unknown as { __sql?: postgres.Sql };

/** Lazy, cached connection: importing this module never connects or throws. */
export function sql(): postgres.Sql {
  if (!hasDatabase()) throw new Error("no database configured");
  // prepare:false because Supabase's transaction pooler cannot hold prepared statements.
  g.__sql ??= postgres(process.env.DATABASE_URL!, { prepare: false, max: 3, idle_timeout: 20 });
  return g.__sql;
}
