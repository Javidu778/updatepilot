'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { devicesResponseSchema, type ConnectionState, type Device } from '@updatepilot/shared';
import { useApiResource } from '@/lib/api/use-api-resource';
import { useAuth } from '@/lib/auth/session';

/**
 * One fetch of GET /api/v1/devices for the whole app shell.
 *
 * The agent indicator in the top bar and the Overview page's agent card both need the same
 * device, and both appear on screen at once. Fetching once here keeps them consistent and
 * halves the requests.
 *
 * Reading this is NOT the security boundary: the API refuses every request without a session.
 */
export type DevicesValue = {
  devices: Device[];
  /** The device the indicator follows: the most recently seen one that is not revoked. */
  primary: Device | null;
  /** The agent state for `primary`, or "pending" when nothing has been paired yet. */
  connection: ConnectionState;
  status: 'loading' | 'ready' | 'error';
  error?: unknown;
  reload: () => void;
};

const DevicesContext = createContext<DevicesValue | null>(null);

const EMPTY: Device[] = [];

export function DevicesProvider({ children }: { children: ReactNode }) {
  const { session, api } = useAuth();
  const signedIn = session.status === 'authenticated';

  // The key changes with the session, so signing out stops the request and signing in starts it.
  const { resource, reload } = useApiResource<Device[]>(
    signedIn ? 'devices' : 'devices:signed-out',
    async (signal) => {
      if (!signedIn) return EMPTY;
      const body = await api.get('/api/v1/devices', { schema: devicesResponseSchema, signal });
      return body.data;
    },
  );

  const value = useMemo<DevicesValue>(() => {
    if (resource.status !== 'ready') {
      return {
        devices: EMPTY,
        primary: null,
        connection: 'pending',
        status: resource.status,
        error: resource.status === 'error' ? resource.error : undefined,
        reload,
      };
    }

    const active = resource.data.filter((device) => device.status !== 'REVOKED');
    const pool = active.length > 0 ? active : resource.data;
    // Same rule as the dashboard endpoint: the device seen most recently represents the agent.
    const primary =
      [...pool].sort(
        (a, b) =>
          (b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0) -
          (a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0),
      )[0] ?? null;

    return {
      devices: resource.data,
      primary,
      connection: primary?.connection ?? 'pending',
      status: 'ready',
      reload,
    };
  }, [resource, reload]);

  return <DevicesContext.Provider value={value}>{children}</DevicesContext.Provider>;
}

export function useDevices(): DevicesValue {
  const context = useContext(DevicesContext);
  if (!context) throw new Error('useDevices must be used inside <DevicesProvider>');
  return context;
}
