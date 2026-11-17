import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Where the agent keeps its token.
 *
 * The token is encrypted with Windows DPAPI for the current user, using the .NET type
 * System.Security.Cryptography.ProtectedData through PowerShell. That keeps the promise in
 * docs/agent-protocol.md §9 without adding a native module or a key we would have to manage:
 * the key is the Windows login itself, so another user account cannot decrypt the file.
 *
 * It is never written to logs, and never to the config file.
 */
const credentialPath = () =>
  join(process.env.LOCALAPPDATA ?? process.cwd(), 'UpdatePilot', 'agent-credential.bin');

const PROTECT = [
  'Add-Type -AssemblyName System.Security;',
  '$bytes=[Text.Encoding]::UTF8.GetBytes($env:UP_TOKEN_SECRET);',
  "$out=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,'CurrentUser');",
  '[IO.File]::WriteAllBytes($env:UP_CRED_PATH,$out);',
].join(' ');

const UNPROTECT = [
  'Add-Type -AssemblyName System.Security;',
  '$bytes=[IO.File]::ReadAllBytes($env:UP_CRED_PATH);',
  "$plain=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,'CurrentUser');",
  '[Text.Encoding]::UTF8.GetString($plain);',
].join(' ');

export async function saveAgentToken(token: string): Promise<void> {
  const path = credentialPath();
  await mkdir(dirname(path), { recursive: true });
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PROTECT], {
    env: { ...process.env, UP_TOKEN_SECRET: token, UP_CRED_PATH: path },
  });
}

export async function loadAgentToken(): Promise<string | null> {
  const path = credentialPath();
  try {
    await readFile(path);
  } catch {
    return null;
  }
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', UNPROTECT],
    {
      env: { ...process.env, UP_CRED_PATH: path },
    },
  );
  const token = stdout.trim();
  return token === '' ? null : token;
}
