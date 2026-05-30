import { and, eq, gt, isNull } from "drizzle-orm";
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { db } from "@/db/client.server";
import { passwordCredentials, passwordResetTokens, profiles, sessions, users } from "@/db/schema";

const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_PARAMS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
};
const SESSION_TOKEN_BYTES = 32;
const PASSWORD_RESET_TOKEN_BYTES = 32;
const DEFAULT_SESSION_DAYS = 7;
const DEFAULT_RESET_MINUTES = 30;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string) {
  assertPasswordShape(password);
  const salt = randomBytes(16);
  const derivedKey = await derivePasswordKey(password, salt, PASSWORD_KEY_LENGTH, PASSWORD_PARAMS);
  return [
    "scrypt",
    PASSWORD_PARAMS.N,
    PASSWORD_PARAMS.r,
    PASSWORD_PARAMS.p,
    salt.toString("hex"),
    derivedKey.toString("hex"),
  ].join("$");
}

export async function verifyPassword(password: string, passwordHash: string) {
  const parts = passwordHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, keyHex] = parts;
  const salt = Buffer.from(saltHex, "hex");
  const storedKey = Buffer.from(keyHex, "hex");
  if (storedKey.length !== PASSWORD_KEY_LENGTH) return false;

  const derivedKey = await derivePasswordKey(password, salt, storedKey.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: PASSWORD_PARAMS.maxmem,
  });

  return timingSafeEqual(storedKey, derivedKey);
}

export async function createUserWithPassword(input: {
  email: string;
  password: string;
  emailVerified?: boolean;
}) {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        emailVerifiedAt: input.emailVerified ? new Date() : null,
      })
      .returning();

    await tx.insert(passwordCredentials).values({
      userId: user.id,
      passwordHash,
    });

    return user;
  });
}

export async function createUserWithPasswordAndProfile(input: {
  email: string;
  password: string;
  fullName?: string | null;
  phone?: string | null;
  emailVerified?: boolean;
}) {
  const email = normalizeEmail(input.email);
  const passwordHash = await hashPassword(input.password);
  const fullName = input.fullName?.trim() || null;
  const phone = input.phone?.trim() || null;

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        emailVerifiedAt: input.emailVerified ? new Date() : null,
      })
      .returning();

    await tx.insert(passwordCredentials).values({
      userId: user.id,
      passwordHash,
    });

    await tx.insert(profiles).values({
      id: user.id,
      fullName,
      phone,
    });

    return user;
  });
}

export async function setUserPassword(userId: string, password: string) {
  const passwordHash = await hashPassword(password);
  await db
    .insert(passwordCredentials)
    .values({
      userId,
      passwordHash,
      passwordChangedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: passwordCredentials.userId,
      set: {
        passwordHash,
        passwordChangedAt: new Date(),
      },
    });
}

export async function authenticateWithPassword(emailInput: string, password: string) {
  const email = normalizeEmail(emailInput);
  const [row] = await db
    .select({
      user: users,
      passwordHash: passwordCredentials.passwordHash,
    })
    .from(users)
    .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
    .where(and(eq(users.email, email), eq(users.isActive, true)))
    .limit(1);

  if (!row) return null;
  const ok = await verifyPassword(password, row.passwordHash);
  return ok ? row.user : null;
}

export async function createSession(userId: string, ttlDays = DEFAULT_SESSION_DAYS) {
  const token = createOpaqueToken(SESSION_TOKEN_BYTES);
  const tokenHash = hashToken(token);
  const expiresAt = minutesFromNow(ttlDays * 24 * 60);

  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      tokenHash,
      expiresAt,
    })
    .returning();

  return { token, session };
}

export async function getSessionByToken(token: string) {
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, tokenHash),
        gt(sessions.expiresAt, new Date()),
        eq(users.isActive, true),
      ),
    )
    .limit(1);

  return row ?? null;
}

export async function revokeSessionToken(token: string) {
  await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

export async function createPasswordResetToken(userId: string, ttlMinutes = DEFAULT_RESET_MINUTES) {
  const token = createOpaqueToken(PASSWORD_RESET_TOKEN_BYTES);
  const tokenHash = hashToken(token);
  const expiresAt = minutesFromNow(ttlMinutes);

  const [resetToken] = await db
    .insert(passwordResetTokens)
    .values({
      userId,
      tokenHash,
      expiresAt,
    })
    .returning();

  return { token, resetToken };
}

export async function consumePasswordResetToken(token: string) {
  const tokenHash = hashToken(token);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.tokenHash, tokenHash),
          gt(passwordResetTokens.expiresAt, new Date()),
          isNull(passwordResetTokens.usedAt),
        ),
      )
      .limit(1);

    if (!row) return null;

    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(eq(passwordResetTokens.id, row.id));

    return row;
  });
}

function createOpaqueToken(bytes: number) {
  return randomBytes(bytes).toString("base64url");
}

function derivePasswordKey(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function minutesFromNow(minutes: number) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

function assertPasswordShape(password: string) {
  if (password.length < 8 || password.length > 128) {
    throw new Error("Password must be between 8 and 128 characters.");
  }
}
