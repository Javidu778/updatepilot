import './load-env';
import { createApp } from './app';
import { loadConfig } from './config';
import { createLogger } from './lib/logger';
import { prisma } from './lib/prisma';

const config = loadConfig();
const logger = createLogger(config.logLevel);

const app = createApp({
  config,
  logger,
  checkDatabase: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
});

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, env: config.nodeEnv }, 'UpdatePilot API listening');
  if (config.enableApiDocs) {
    logger.info(`API docs: http://localhost:${config.port}/api/docs`);
  }
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  // Force exit if connections do not close in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
