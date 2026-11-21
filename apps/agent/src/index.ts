import * as os from 'node:os';
import { agentJobSchema, scannedApplicationSchema } from '@updatepilot/shared';
import { AgentApi, AgentHttpError, apiBaseUrl } from './api-client';
import { loadAgentToken, saveAgentToken } from './credential-store';
import { readInventory } from './winget/run';

const AGENT_VERSION = '0.1.0';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Exchanges a one-time code for this device's credential. The token is never printed. */
async function pair(): Promise<void> {
  const code = argument('code');
  const name = argument('name') ?? os.hostname();
  if (!code) {
    console.error('Usage: npm run pair -w apps/agent -- --code ABCD-1234 [--name THIS-PC]');
    process.exitCode = 1;
    return;
  }

  const api = new AgentApi(apiBaseUrl());
  const result = await api.pair({
    pairingCode: code.toUpperCase(),
    deviceName: name,
    osVersion: os.version(),
    agentVersion: AGENT_VERSION,
  });

  await saveAgentToken(result.agentToken);
  console.log(
    `Paired as "${name}" (device ${result.deviceId}). Credential stored for this Windows user.`,
  );
}

/**
 * The poll loop. Today it only claims a job and logs it: running WinGet arrives on Day 3.
 *
 * Backoff follows docs/agent-protocol.md §7: growing delays, stop on 401, stop on 403.
 */
async function run(): Promise<void> {
  const token = await loadAgentToken();
  if (!token) {
    console.error(
      'No credential found. Pair this device first: npm run pair -w apps/agent -- --code ABCD-1234',
    );
    process.exitCode = 1;
    return;
  }

  const api = new AgentApi(apiBaseUrl(), token);
  let intervalSeconds = 10;
  let failureDelay = 0;

  for (;;) {
    try {
      const { job, pollIntervalSeconds } = await api.nextJob();
      intervalSeconds = pollIntervalSeconds;
      failureDelay = 0;

      if (job) {
        // Principle 3: validate independently, with the same schema the API used.
        const parsed = agentJobSchema.safeParse(job);
        if (!parsed.success) {
          console.error('Ignoring a job that failed validation:', parsed.error.issues[0]?.message);
        } else if (parsed.data.kind === 'scan') {
          console.log(`Scan ${parsed.data.jobId}: reading installed software...`);
          const startedAt = new Date();
          const applications = await readInventory();
          const finishedAt = new Date();
          const valid = applications.filter(
            (application) => scannedApplicationSchema.safeParse(application).success,
          );
          if (valid.length !== applications.length) {
            console.warn(
              `Dropped ${applications.length - valid.length} applications that failed validation.`,
            );
          }
          try {
            await api.submitScanResults(parsed.data.jobId, {
              startedAt: startedAt.toISOString(),
              finishedAt: finishedAt.toISOString(),
              applications: valid,
            });
            console.log(`Scan ${parsed.data.jobId}: submitted ${valid.length} applications.`);
          } catch (error) {
            if (error instanceof AgentHttpError && error.status === 409) {
              console.warn(`Scan ${parsed.data.jobId} was already finalized; continuing.`);
            } else {
              throw error;
            }
          }
        } else {
          console.log(
            `Claimed ${parsed.data.kind} job ${parsed.data.jobId}; updates arrive on Day 5.`,
          );
        }
      }

      await sleep(intervalSeconds * 1000);
    } catch (error) {
      if (error instanceof AgentHttpError) {
        if (error.status === 401) {
          console.error('Agent credentials are invalid. Pair this device again.');
          process.exitCode = 1;
          return;
        }
        if (error.status === 403) {
          console.error('This device was revoked. Pair it again.');
          process.exitCode = 1;
          return;
        }
        if (error.status === 429) {
          const wait = Number(error.retryAfterSeconds ?? intervalSeconds);
          await sleep((Number.isFinite(wait) ? wait : intervalSeconds) * 1000);
          continue;
        }
      }

      failureDelay = failureDelay === 0 ? 10 : Math.min(failureDelay * 3, 60);
      console.error(`Poll failed: ${(error as Error).message}. Retrying in ${failureDelay}s.`);
      await sleep(failureDelay * 1000);
    }
  }
}

const command = process.argv[2] ?? 'run';
const entry = command === 'pair' ? pair : run;

void entry().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
