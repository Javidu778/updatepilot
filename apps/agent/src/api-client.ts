import {
  agentNextJobResponseSchema,
  pairResponseSchema,
  type AgentJob,
  type ScannedApplication,
} from '@updatepilot/shared';

/** https is required for anything that is not the local development API (protocol §9). */
export function apiBaseUrl(): string {
  const url = process.env.UPDATEPILOT_API_URL ?? 'http://localhost:4000';
  const parsed = new URL(url);
  if (
    parsed.protocol !== 'https:' &&
    parsed.hostname !== 'localhost' &&
    parsed.hostname !== '127.0.0.1'
  ) {
    throw new Error('The API URL must use https unless it points at localhost.');
  }
  return url.replace(/\/+$/, '');
}

export class AgentApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token?: string,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(init.headers as Record<string, string>),
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const code = (json as { error?: { code?: string } } | null)?.error?.code ?? 'UNKNOWN';
      throw new AgentHttpError(response.status, code, response.headers.get('retry-after'));
    }
    return json;
  }

  async submitScanResults(
    jobId: string,
    results: { startedAt: string; finishedAt: string; applications: ScannedApplication[] },
  ): Promise<unknown> {
    return this.request(`/api/v1/agent/scans/${jobId}/results`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(results),
    });
  }

  async pair(input: {
    pairingCode: string;
    deviceName: string;
    osVersion?: string;
    agentVersion?: string;
  }) {
    const json = await this.request('/api/v1/devices/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return pairResponseSchema.parse(json);
  }

  async nextJob(): Promise<{
    job: AgentJob | null;
    pollIntervalSeconds: number;
    serverTime: string;
  }> {
    return agentNextJobResponseSchema.parse(await this.request('/api/v1/agent/jobs/next'));
  }
}

export class AgentHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly retryAfterSeconds: string | null,
  ) {
    super(`The API answered ${status} (${code})`);
    this.name = 'AgentHttpError';
  }
}
