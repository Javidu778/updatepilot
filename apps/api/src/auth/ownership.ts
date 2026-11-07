import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { notFound } from './errors';

/**
 * Ownership helpers. EVERY route that takes a device or application ID must load it through
 * one of these, never with a bare findUnique({ where: { id } }).
 *
 * A resource that does not exist and one that belongs to someone else both give 404, so an
 * attacker cannot learn which IDs exist.
 */
const uuid = z.uuid();

export async function getOwnedDevice(userId: string, deviceId: string) {
  if (!uuid.safeParse(deviceId).success) throw notFound('Device');
  const device = await prisma.device.findFirst({ where: { id: deviceId, ownerId: userId } });
  if (!device) throw notFound('Device');
  return device;
}

export async function getOwnedApplication(userId: string, applicationId: string) {
  if (!uuid.safeParse(applicationId).success) throw notFound('Application');
  const application = await prisma.application.findFirst({
    where: { id: applicationId, device: { ownerId: userId } },
  });
  if (!application) throw notFound('Application');
  return application;
}
