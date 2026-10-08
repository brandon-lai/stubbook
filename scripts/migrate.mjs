// Applies db/migrations/*.sql in order, once each. DATABASE_URL from env or .env.local.
import postgres from "postgres";
import { readdirSync, readFileSync, existsSync } from "node:fs";
for (const f of [".env.local", ".env"]) if (!process.env.DATABASE_URL && existsSync(f)) process.loadEnvFile(f);
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
await sql`create table if not exists _migrations (name text primary key, at timestamptz default now())`;
const done = new Set((await sql`select name from _migrations`).map((r) => r.name));
for (const f of readdirSync("db/migrations").filter((f) => f.endsWith(".sql")).sort()) {
  if (done.has(f)) continue;
  await sql.begin(async (tx) => { await tx.unsafe(readFileSync(`db/migrations/${f}`, "utf8")); await tx`insert into _migrations (name) values (${f})`; });
  console.log("applied", f);
}
await sql.end();
