// Cross-process executor: a standalone Inngest connect() worker. This is a DIFFERENT process
// from the one that serves /api/agents/greeter/stream. It is what makes the bug reproduce.
import { connect } from '@mastra/inngest/connect';
import { mastra } from './index.ts';
import { inngest } from './inngest.ts';

const conn = await connect({ mastra, inngest, instanceId: 'repro-worker', maxWorkerConcurrency: 4 });
const shutdown = async () => { try { await conn.close(); await (mastra as any).shutdown?.(); } finally { process.exit(0); } };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
