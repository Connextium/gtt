import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const migrationDir = new URL("../supabase/migrations", import.meta.url);
const files = (await readdir(migrationDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  throw new Error("No SQL migrations found.");
}

for (const [index, file] of files.entries()) {
  const expectedPrefix = String(index + 1).padStart(4, "0");
  if (!file.startsWith(expectedPrefix)) {
    throw new Error(`Migration ${file} must start with ${expectedPrefix}.`);
  }

  const sql = await readFile(join(migrationDir.pathname, file), "utf8");
  if (!/\b(create|alter|drop|insert|update|delete)\b/i.test(sql)) {
    throw new Error(`Migration ${file} must include forward SQL.`);
  }

  if (sql.includes("-- migrate:down")) {
    throw new Error(`Migration ${file} must not include a migrate:down section.`);
  }
}

console.log(`Validated ${files.length} migration file(s).`);
