import pg from "pg";
import { loadDotEnv, projectRootFromMeta, requireEnv } from "./shared.mjs";

const rootDir = projectRootFromMeta(import.meta.url);
loadDotEnv(rootDir);

const databaseUrl = requireEnv("DATABASE_URL");
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();

  const { rows } = await client.query(`
    select
      count(*)::int as total_users,
      count(pc.user_id)::int as users_with_password,
      (count(*) - count(pc.user_id))::int as users_missing_password
    from users u
    left join password_credentials pc on pc.user_id = u.id
    where u.is_active = true
  `);

  const summary = rows[0];
  console.log(`active users: ${summary.total_users}`);
  console.log(`users with PostgreSQL password: ${summary.users_with_password}`);
  console.log(`users missing PostgreSQL password: ${summary.users_missing_password}`);

  if (summary.users_missing_password > 0) {
    const missing = await client.query(`
      select u.id, u.email, p.full_name
      from users u
      left join password_credentials pc on pc.user_id = u.id
      left join profiles p on p.id = u.id
      where u.is_active = true and pc.user_id is null
      order by u.created_at
    `);

    console.log("\nUsers that need a PostgreSQL password:");
    for (const user of missing.rows) {
      console.log(`- ${user.email} (${user.full_name ?? user.id})`);
    }
  }
} finally {
  await client.end();
}
