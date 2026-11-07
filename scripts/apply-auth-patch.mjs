#!/usr/bin/env node
/**
 * Week 2 Day 2: applies the small edits that authentication needs to existing files.
 *   1. apps/api/prisma/schema.prisma   adds the Session table, User.sessions and USER_LOGOUT
 *   2. packages/shared/src/enums.ts    adds USER_LOGOUT
 *   3. packages/shared/src/api.ts      adds authResponseSchema
 *   4. apps/api/prisma/seed.ts         uses the shared password hashing
 *
 * Run from the repo root:  node scripts/apply-auth-patch.mjs
 * Safe to run twice: edits that are already present are skipped.
 * If an expected spot is not found, it tells you and changes nothing in that file.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

let problems = 0;

function patch(file, edits) {
  if (!existsSync(file)) {
    console.log(`SKIP   ${file} (file not found)`);
    problems++;
    return;
  }
  let text = readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const original = text;
  const messages = [];

  for (const edit of edits) {
    if (edit.alreadyDone(text)) {
      messages.push(`  already applied: ${edit.name}`);
      continue;
    }
    const next = edit.apply(text, eol);
    if (next === null || next === text) {
      messages.push(`  NOT FOUND:       ${edit.name} (add it by hand, see docs/auth.md)`);
      problems++;
      continue;
    }
    text = next;
    messages.push(`  applied:         ${edit.name}`);
  }

  if (text !== original) writeFileSync(file, text, 'utf8');
  console.log(`${text !== original ? 'PATCHED' : 'OK     '} ${file}`);
  for (const m of messages) console.log(m);
}

const nl = (eol, ...lines) => lines.join(eol);

patch('apps/api/prisma/schema.prisma', [
  {
    name: 'USER_LOGOUT audit event',
    alreadyDone: (t) => /\bUSER_LOGOUT\b/.test(t),
    apply: (t) =>
      /(\n[ \t]*USER_LOGIN)(\r?\n)/.test(t)
        ? t.replace(/(\n[ \t]*USER_LOGIN)(\r?\n)/, `$1$2  USER_LOGOUT$2`)
        : null,
  },
  {
    name: 'User.sessions relation',
    alreadyDone: (t) => /sessions\s+Session\[\]/.test(t),
    apply: (t) => {
      const re = /(model User \{[\s\S]*?)(\r?\n)([ \t]*devices[ \t]+Device\[\])/;
      return re.test(t) ? t.replace(re, `$1$2  sessions     Session[]$2$3`) : null;
    },
  },
  {
    name: 'Session model',
    alreadyDone: (t) => /model Session \{/.test(t),
    apply: (t, eol) => {
      if (!/model Device \{/.test(t)) return null;
      const block = nl(
        eol,
        '// Server-side login session. The browser holds only a random token in an httpOnly cookie.',
        'model Session {',
        '  id         String   @id @default(uuid()) @db.Uuid',
        '  userId     String   @db.Uuid',
        '  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)',
        '  // SHA-256 hash of the random session token. The raw token exists only in the cookie.',
        '  tokenHash  String   @unique',
        '  createdAt  DateTime @default(now())',
        '  expiresAt  DateTime',
        '  lastUsedAt DateTime @default(now())',
        '',
        '  @@index([userId])',
        '  @@index([expiresAt])',
        '}',
        '',
        '',
      );
      return t.replace(/model Device \{/, `${block}model Device {`);
    },
  },
]);

patch('packages/shared/src/enums.ts', [
  {
    name: "'USER_LOGOUT' audit event type",
    alreadyDone: (t) => /'USER_LOGOUT'/.test(t),
    apply: (t) => {
      const re = /(\r?\n)([ \t]*)'USER_LOGIN',/;
      return re.test(t) ? t.replace(re, `$1$2'USER_LOGIN',$1$2'USER_LOGOUT',`) : null;
    },
  },
]);

patch('packages/shared/src/api.ts', [
  {
    name: 'authResponseSchema',
    alreadyDone: (t) => /authResponseSchema/.test(t),
    apply: (t, eol) => {
      const anchor = /export type User = z\.infer<typeof userSchema>;/;
      if (!anchor.test(t)) return null;
      const block = nl(
        eol,
        'export type User = z.infer<typeof userSchema>;',
        '',
        '// Returned by register, login and GET /auth/me.',
        '// The client sends csrfToken back in the X-CSRF-Token header on state-changing requests.',
        'export const authResponseSchema = z.object({',
        '  user: userSchema,',
        '  csrfToken: z.string(),',
        '});',
        'export type AuthResponse = z.infer<typeof authResponseSchema>;',
      );
      return t.replace(anchor, block);
    },
  },
]);

patch('apps/api/prisma/seed.ts', [
  {
    name: 'import hashPassword instead of bcryptjs',
    alreadyDone: (t) => /import \{ hashPassword \}/.test(t),
    apply: (t) =>
      /import bcrypt from 'bcryptjs';/.test(t)
        ? t.replace(
            /import bcrypt from 'bcryptjs';/,
            "import { hashPassword } from '../src/auth/password';",
          )
        : null,
  },
  {
    name: 'use hashPassword for the demo user',
    alreadyDone: (t) => !/bcrypt\.hash\(/.test(t),
    apply: (t) => t.replace(/await bcrypt\.hash\(([^,)]+),\s*\d+\)/, 'await hashPassword($1)'),
  },
]);

if (problems > 0) {
  console.log(
    `\nFinished with ${problems} problem(s). Fix the items marked NOT FOUND / SKIP, then run it again.`,
  );
  process.exit(1);
}
console.log('\nAll edits are in place.');
