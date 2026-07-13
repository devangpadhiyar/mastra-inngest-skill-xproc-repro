/**
 * Fire ONE stream turn that forces the agent to call the `skill` tool, via the running Mastra
 * server's HTTP endpoint. Because a separate Inngest connect() WORKER process executes the durable
 * steps (cross-process), the tool-call step can't resolve the workspace `skill` tool and returns
 * ToolNotFoundError — even though the model correctly emits `skill({ name: "greeting" })`.
 *
 * Prereqs (see README):
 *   1. Inngest dev server:  npx inngest-cli@latest dev -u http://localhost:4333/inngest/api
 *   2. Mastra server:       npm run dev
 *   3. Connect worker:      npm run worker      (SEPARATE process — this is what triggers the bug)
 *   4. OPENAI_API_KEY set in .env
 * Then:  npm run repro
 */
const BASE = process.env.MASTRA_URL ?? 'http://localhost:4333';

const res = await fetch(`${BASE}/api/agents/greeter/stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'How do I greet someone? Load the greeting skill first, then tell me.' }],
  }),
});

const reader = res.body!.getReader();
const dec = new TextDecoder();
let buf = '';
let sawSkillCall = false;
let toolNotFound = false;
let finalText = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
  for (const line of buf.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const ev = JSON.parse(payload);
      if ((ev.type === 'tool-input-available' || ev.type === 'tool-call-input-streaming-start') && (ev.toolName === 'skill' || ev?.payload?.toolName === 'skill')) sawSkillCall = true;
      if ((ev.type === 'tool-output-error' || ev.type === 'tool-error') && /ToolNotFound/.test(JSON.stringify(ev))) toolNotFound = true;
      if (ev.type === 'error' && JSON.stringify(ev).includes('ToolNotFound')) toolNotFound = true;
      if (ev.type === 'text-delta' && ev.delta) finalText += ev.delta;
      if (ev.type === 'text-delta' && ev?.payload?.text) finalText += ev.payload.text;
    } catch { /* partial line */ }
  }
  buf = buf.slice(buf.lastIndexOf('\n') + 1);
}

console.log('\n=== RESULT ===');
console.log('model emitted skill() call :', sawSkillCall);
console.log('ToolNotFoundError observed :', toolNotFound);
console.log('final text                 :', finalText.slice(0, 120).replace(/\n/g, ' ') || '(none)');
console.log(
  toolNotFound
    ? '\n❌ BUG REPRODUCED — skill tool not found cross-process on the connect worker'
    : sawSkillCall
      ? '\n✅ skill tool executed (bug NOT present)'
      : '\n⚠️  model did not call skill — rerun (LLM nondeterminism)'
);
process.exit(0);
