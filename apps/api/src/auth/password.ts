import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';

/**
 * Passwords are hashed with bcrypt.
 *
 * bcrypt silently ignores everything after 72 bytes, and our policy allows up to 128
 * characters. So the password is first reduced with SHA-256 (base64, 44 chars), which
 * makes every character count and avoids the 72-byte limit.
 *
 * This file must not import the database or config so the seed script can use it.
 */
const cost = () => (process.env.NODE_ENV === 'test' ? 4 : 12);

function prehash(password: string): string {
  return createHash('sha256').update(password, 'utf8').digest('base64');
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(prehash(password), cost());
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(prehash(password), hash);
}

let dummyHash: Promise<string> | undefined;

/**
 * Runs a real comparison against a throwaway hash. Used when the email is unknown so a
 * login for a missing account takes about as long as one for an existing account.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword('dummy-password-used-only-for-timing');
  await verifyPassword(password, await dummyHash);
  return false;
}
