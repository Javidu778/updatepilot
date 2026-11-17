import type { AgentCredential, Device } from '../../generated/prisma/client';

/** Added to the request by authenticateAgent. Handlers can rely on it after that middleware. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      agent?: {
        device: Device;
        credential: AgentCredential;
      };
    }
  }
}

export {};
