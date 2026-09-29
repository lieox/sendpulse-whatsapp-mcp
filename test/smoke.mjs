// Smoke test without real credentials. Starts the server the way an MCP client does and checks
// the tool list in each mode, the missing-credentials exit, and a live 401 from SendPulse.
// Usage: node test/smoke.mjs                      (tests dist/index.js)
//        node test/smoke.mjs npx -y github:...    (tests any launch command)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const [command, ...args] = process.argv.length > 2 ? process.argv.slice(2) : ["node", entry];
const FAKE = { SENDPULSE_CLIENT_ID: "fake-id", SENDPULSE_CLIENT_SECRET: "fake-secret" };
const TIMEOUT = { timeout: 180_000 };

async function withServer(env, fn) {
  const transport = new StdioClientTransport({ command, args, env: { ...getDefaultEnvironment(), ...env } });
  const client = new Client({ name: "smoke", version: "0" });
  await client.connect(transport, TIMEOUT);
  try { return await fn(client); } finally { await client.close(); }
}

const listTools = async (client) => (await client.listTools(undefined, TIMEOUT)).tools;
const writeTools = (tools) => tools.filter((t) => !t.annotations?.readOnlyHint);
const accountRequired = (tools) => (tools.find((t) => t.name === "sendpulse_list_bots").inputSchema.required ?? []).includes("account");

await withServer(FAKE, async (client) => {
  const tools = await listTools(client);
  assert.equal(tools.length, 26);
  assert.equal(writeTools(tools).length, 16);
  assert.equal(accountRequired(tools), false);
  const res = await client.callTool({ name: "sendpulse_list_bots", arguments: {} }, undefined, TIMEOUT);
  assert.match(res.content[0].text, /Authentication failed/);
  console.log("ok  single account: 26 tools, account optional, SendPulse rejects a fake secret");
});

await withServer({ ...FAKE, SENDPULSE_READ_ONLY: "1" }, async (client) => {
  const tools = await listTools(client);
  assert.equal(tools.length, 10);
  assert.equal(writeTools(tools).length, 0);
  const res = await client.callTool({ name: "sendpulse_send_message", arguments: { contact_id: "x", message: { type: "text", text: "x" } } }, undefined, TIMEOUT);
  assert.equal(res.isError, true);
  console.log("ok  read-only: 10 tools, send_message is not callable");
});

const two = { a: { id: "fake", secret: "fake" }, b: { id: "fake", secret: "fake" } };
await withServer({ SENDPULSE_ACCOUNTS: JSON.stringify(two) }, async (client) => {
  const tools = await listTools(client);
  assert.equal(tools.length, 26);
  assert.equal(accountRequired(tools), true);
  console.log("ok  several accounts: account is required");
});

if (command === "node") {
  const bare = spawnSync(command, args, { env: getDefaultEnvironment(), encoding: "utf8" });
  assert.equal(bare.status, 1);
  assert.match(bare.stderr, /SENDPULSE_CLIENT_ID/);
  console.log("ok  no credentials: exits 1 with a clear message");
}
