#!/usr/bin/env node
/* global console, fetch */
// External MCP client check for ScenarioForge (M9). NOT RUN by any agent.
//
// What it does: speaks MCP JSON-RPC over HTTP to the app's Forge MCP endpoint
// with a bearer token the owner obtained through the OAuth consent flow, lists
// tools, and calls the three read-only issue tools once. It writes nothing to
// Jira or Confluence (the tools are GET actions) and prints no token.
//
// Run only after the owner has approved the deploy and enabled exposure
// (docs/M9_MCP_EXTERNAL_TEST.md). Usage:
//   MCP_TOKEN=<access token> MCP_CONFIRM=yes node scripts/mcp-external-check.mjs MC-62
// Evidence: redirect stdout to docs/evidence/mcp-live-<date>.txt after review.
import { argv, env, exit } from 'node:process';

const APP_ID = '113a7a88-0d52-4161-b72e-791a83bd9355';
const URL_ = env.MCP_URL ?? `https://mcp.atlassian.com/forge/${APP_ID}`;
const EXPECTED = [
  'find-recovery-risks',
  'get-service-readiness',
  'prepare-rehearsal',
  'explain-outcome',
];
const issueKey = argv[2];

if (env.MCP_CONFIRM !== 'yes' || !env.MCP_TOKEN || !/^[A-Z][A-Z0-9]+-\d+$/.test(issueKey ?? '')) {
  console.error(
    'Refusing to run: set MCP_CONFIRM=yes, MCP_TOKEN, and pass an issue key like MC-62.',
  );
  exit(2);
}

let id = 0;
async function rpc(method, params) {
  const response = await fetch(URL_, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${env.MCP_TOKEN}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const text = await response.text();
  return { status: response.status, body: text.slice(0, 4000) };
}

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
};

const init = await rpc('initialize', {
  protocolVersion: '2025-03-26',
  capabilities: {},
  clientInfo: { name: 'scenarioforge-check', version: '1' },
});
check('initialize answers 200', init.status === 200, `HTTP ${init.status}`);

const list = await rpc('tools/list', {});
check('tools/list answers 200', list.status === 200, `HTTP ${list.status}`);
for (const tool of EXPECTED) check(`tool listed: ${tool}`, list.body.includes(tool));
check('no unexpected write-like tool', !/create|update|delete|transition|comment/i.test(list.body));

for (const tool of ['find-recovery-risks', 'get-service-readiness']) {
  const call = await rpc('tools/call', { name: tool, arguments: { changeKey: issueKey } });
  check(`${tool} answers 200`, call.status === 200, `HTTP ${call.status}`);
  console.log(call.body.slice(0, 1200));
  check(
    `${tool} states a verdict or Not assessed`,
    /verdict|Not assessed|not-assessed/.test(call.body),
  );
}

const bad = await rpc('tools/call', {
  name: 'find-recovery-risks',
  arguments: { changeKey: 'MC-62 OR project = X' },
});
check('malformed key rejected', /INVALID_INPUT|invalid/i.test(bad.body));

const failed = results.filter((r) => !r.pass).length;
console.log(
  `\n${results.length - failed}/${results.length} checks passed. Record this output as evidence only if the owner ran it.`,
);
exit(failed === 0 ? 0 : 1);
