import { z } from 'zod';

/**
 * Identifiers that reach the Windows agent MUST pass these validators on the API
 * AND again on the agent. The patterns allow only letters, digits and . + _ -
 * so no shell metacharacter, space, quote, slash or newline can get through.
 *
 * Even so, the agent never builds a shell string: it passes arguments as an array.
 */

// Examples: Microsoft.VisualStudioCode, Notepad++.Notepad++, 7zip.7zip, Microsoft.VCRedist.2015+.x64
export const PACKAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+_-]{1,127}$/;

// Strict version used for operations (update targets). Examples: 24.08, 2.45.1, 1.91.1-beta.2
export const TARGET_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/;

export const packageIdSchema = z
  .string()
  .regex(PACKAGE_ID_PATTERN, 'Invalid package identifier')
  .refine((id) => !id.includes('..'), 'Invalid package identifier');

export const targetVersionSchema = z
  .string()
  .regex(TARGET_VERSION_PATTERN, 'Invalid version')
  .refine((v) => !v.includes('..'), 'Invalid version');

/**
 * Looser version for DISPLAY and inventory data reported by the agent.
 * Installed versions can contain spaces or odd text (for example "2024.1 (build 5)"),
 * so this is never used to build a command. Control characters are rejected.
 */
const NO_CONTROL_CHARS = /^[^\u0000-\u001F\u007F]*$/;
export const displayVersionSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(NO_CONTROL_CHARS, 'Invalid characters');

/** Only WinGet is supported in the MVP. */
export const packageSourceSchema = z.literal('winget');
export type PackageSource = z.infer<typeof packageSourceSchema>;

/**
 * The complete list of operations the agent will ever perform.
 * Anything else is rejected, no matter who asks.
 */
export const AGENT_OPERATIONS = ['scan', 'upgrade'] as const;
export type AgentOperation = (typeof AGENT_OPERATIONS)[number];

export const agentJobSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('scan'),
    jobId: z.uuid(),
  }),
  z.strictObject({
    kind: z.literal('upgrade'),
    jobId: z.uuid(),
    packageId: packageIdSchema,
    targetVersion: targetVersionSchema,
    source: packageSourceSchema,
  }),
]);
export type AgentJob = z.infer<typeof agentJobSchema>;
