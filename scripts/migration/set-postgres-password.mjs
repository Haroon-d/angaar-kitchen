import { randomBytes, scrypt } from "node:crypto";
import pg from "pg";
import { loadDotEnv, parseArgs, projectRootFromMeta, requireEnv } from "./shared.mjs";

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};

const rootDir = projectRootFromMeta(import.meta.url);
loadDotEnv(rootDir);

const args = parseArgs(process.argv.slice(2));
const email = typeof args.email === "string" ? args.email.trim().toLowerCase() : null;
const userId = typeof args.userId === "string" ? args.userId.trim() : null;
const generatedPassword = args.generate ? randomPassword() : null;
const password = normalizePassword(
  args.password ?? process.env.POSTGRES_USER_PASSWORD ?? generatedPassword,
);

if (!email && !userId) {
  throw new Error("Pass --email user@example.com or --user-id <uuid>.");
}
if (!password) {
  throw new Error("Pass --password, set POSTGRES_USER_PASSWORD, or use --generate.");
}

const databaseUrl = requireEnv("DATABASE_URL");
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query("begin");

  const { rows } = await client.query(
    `
      select id, email
      from users
      where ${email ? "email = $1" : "id = $1"} and is_active = true
      limit 1
    `,
    [email ?? userId],
  );

  const user = rows[0];
  if (!user) {
    throw new Error("Active user was not found.");
  }

  const passwordHash = await hashPassword(password);
  await client.query(
    `
      insert into password_credentials (user_id, password_hash, password_changed_at)
      values ($1, $2, now())
      on conflict (user_id)
      do update set password_hash = excluded.password_hash, password_changed_at = now()
    `,
    [user.id, passwordHash],
  );

  await client.query("commit");

  console.log(`PostgreSQL password set for ${user.email}.`);
  if (generatedPassword) {
    console.log(`Generated temporary password: ${generatedPassword}`);
  }
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}

async function hashPassword(passwordInput) {
  if (passwordInput.length < 8 || passwordInput.length > 128) {
    throw new Error("Password must be between 8 and 128 characters.");
  }

  const salt = randomBytes(16);
  const derivedKey = await derivePasswordKey(
    passwordInput,
    salt,
    PASSWORD_KEY_LENGTH,
    PASSWORD_PARAMS,
  );
  return [
    "scrypt",
    PASSWORD_PARAMS.N,
    PASSWORD_PARAMS.r,
    PASSWORD_PARAMS.p,
    salt.toString("hex"),
    derivedKey.toString("hex"),
  ].join("$");
}

function derivePasswordKey(passwordInput, salt, keyLength, options) {
  return new Promise((resolve, reject) => {
    scrypt(passwordInput, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

function normalizePassword(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function randomPassword() {
  return randomBytes(18).toString("base64url");
}
