import { Router } from 'express';
import { requireAuth } from '../auth';
import { toDevice } from '../inventory/serialize';
import { prisma } from '../lib/prisma';
import { noStore } from '../middleware/no-store';

/** Mount at /api/v1/devices. */
export function devicesRouter(): Router {
  const router = Router();
  router.use(noStore);

  // GET /api/v1/devices: the signed-in user's devices.
  router.get('/', requireAuth, async (req, res) => {
    const rows = await prisma.device.findMany({
      where: { ownerId: req.auth!.user.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const now = new Date();
    res.json({ data: rows.map((row) => toDevice(row, now)) });
  });

  return router;
}
