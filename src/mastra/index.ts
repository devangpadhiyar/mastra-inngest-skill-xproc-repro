import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mastra } from '@mastra/core/mastra';
import { Agent } from '@mastra/core/agent';
import { Workspace, LocalFilesystem } from '@mastra/core/workspace';
import { createInngestAgent, serve as inngestServe } from '@mastra/inngest';
import { openai } from '@ai-sdk/openai';
import { inngest } from './inngest.ts';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(here, '..', '..'); // repo root, which contains skills/greeting

// Canonical workspace with a filesystem + skills discovery (docs: Workspace skills).
const workspace = new Workspace({
  filesystem: new LocalFilesystem({ basePath: projectRoot }),
  skills: ['skills/greeting'], // resolves to <root>/skills/greeting via the default (filesystem) skill source
});

const agent = new Agent({
  id: 'greeter',
  name: 'Greeter',
  instructions:
    'You help with greetings. When the user asks how to greet, FIRST call the `skill` tool with { "name": "greeting" } to load the greeting skill, then answer using it. Never ask the user anything.',
  model: openai('gpt-4o-mini'),
});

// Durable, Inngest-backed. Same pattern as the docs' createInngestAgent quickstart.
const durable = createInngestAgent({ agent, inngest });

export const mastra = new Mastra({
  agents: { greeter: durable },
  workspace, // instance-level workspace → agent inherits it (docs: workspace skills)
  server: {
    host: '127.0.0.1',
    port: 4333,
    apiRoutes: [
      {
        path: '/inngest/api',
        method: 'ALL',
        handler: async (c: any) => inngestServe({ mastra: c.get('mastra'), inngest })(c),
      },
    ],
  },
});
