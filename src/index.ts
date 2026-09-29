#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios, { AxiosError } from "axios";

const AUTH_URL = "https://api.sendpulse.com/oauth/access_token";
const API_BASE = "https://api.sendpulse.com/whatsapp";
const CHARACTER_LIMIT = 25000;

interface AccountConfig { id: string; secret: string; }
interface TokenCache { token: string; expiresAt: number; }

function loadAccounts(): Record<string, AccountConfig> {
  const { SENDPULSE_CLIENT_ID: id, SENDPULSE_CLIENT_SECRET: secret, SENDPULSE_ACCOUNTS: raw } = process.env;
  if (id && secret) return { default: { id, secret } };
  if (!raw) {
    console.error("ERROR: set SENDPULSE_CLIENT_ID and SENDPULSE_CLIENT_SECRET (one account) or SENDPULSE_ACCOUNTS (several)");
    process.exit(1);
  }
  try {
    return JSON.parse(raw) as Record<string, AccountConfig>;
  } catch {
    console.error("ERROR: SENDPULSE_ACCOUNTS must be valid JSON");
    process.exit(1);
  }
}

const accounts = loadAccounts();
const tokenCache: Record<string, TokenCache> = {};

async function getToken(account: string): Promise<string> {
  const cached = tokenCache[account];
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;
  const cfg = accounts[account];
  if (!cfg) throw new Error(`Unknown account "${account}". Available: ${Object.keys(accounts).join(", ")}`);
  const resp = await axios.post(AUTH_URL, {
    grant_type: "client_credentials",
    client_id: cfg.id,
    client_secret: cfg.secret,
  });
  const token = resp.data.access_token as string;
  const expiresIn = (resp.data.expires_in as number) || 3600;
  tokenCache[account] = { token, expiresAt: Date.now() + expiresIn * 1000 };
  return token;
}

async function api<T>(
  account: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  data?: unknown,
  params?: unknown
): Promise<T> {
  const token = await getToken(account);
  const resp = await axios({
    method, url: `${API_BASE}${path}`, data, params,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    timeout: 30_000,
  });
  return resp.data as T;
}

function handleError(error: unknown): string {
  if (error instanceof AxiosError) {
    const s = error.response?.status;
    if (s === 401) return "Error: Authentication failed. Check your SendPulse credentials.";
    if (s === 403) return "Error: Permission denied.";
    if (s === 404) return "Error: Resource not found. Check the ID is correct.";
    if (s === 429) return "Error: Rate limit exceeded (max 10 req/s). Please wait before retrying.";
    const msg = (error.response?.data as { message?: string })?.message ?? error.message;
    return `Error: API request failed (${s ?? "network"}): ${msg}`;
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

function fmt(data: unknown): string {
  const text = JSON.stringify(data, null, 2);
  return text.length > CHARACTER_LIMIT ? text.slice(0, CHARACTER_LIMIT) + "\n...[truncated — use filters or pagination]" : text;
}

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: fmt(data) }] });
const err = (e: unknown) => ({ content: [{ type: "text" as const, text: handleError(e) }] });

const accountNames = Object.keys(accounts);
const Account = accountNames.length === 1
  ? z.string().default(accountNames[0]).describe(`Account name (only one configured: ${accountNames[0]})`)
  : z.string().describe(`Account name. Available: ${accountNames.join(", ")}`);
const BotId = z.string().describe("Bot ID (from sendpulse_list_bots)");

const READ_ONLY = /^(1|true|yes)$/i.test(process.env.SENDPULSE_READ_ONLY ?? "");

const server = new McpServer({ name: "sendpulse-whatsapp-mcp", version: "1.1.0" });

// In read-only mode every tool without readOnlyHint (sending, tagging, flows, campaigns) is dropped.
const registerTool: typeof server.registerTool = (name, config, cb) => {
  const tool = server.registerTool(name, config, cb);
  if (READ_ONLY && !config.annotations?.readOnlyHint) tool.remove();
  return tool;
};

// ── BOTS ─────────────────────────────────────────────────────────────────────

registerTool("sendpulse_list_bots", {
  title: "List WhatsApp Bots",
  description: "List all connected WhatsApp bots for an account. Use this first to get bot IDs.",
  inputSchema: { account: Account },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account }) => {
  try { return ok(await api(account, "GET", "/bots")); } catch (e) { return err(e); }
});

registerTool("sendpulse_get_bot_stats", {
  title: "Get Bot Statistics",
  description: "Get subscriber counts and message statistics for a specific bot.",
  inputSchema: { account: Account, bot_id: BotId },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, bot_id }) => {
  try { return ok(await api(account, "GET", "/bots/statistics", undefined, { bot_id })); } catch (e) { return err(e); }
});

// ── CONTACTS ─────────────────────────────────────────────────────────────────

registerTool("sendpulse_get_contact", {
  title: "Get Contact by ID",
  description: "Get a WhatsApp contact's details by their contact ID.",
  inputSchema: { account: Account, id: z.string().describe("Contact ID") },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, id }) => {
  try { return ok(await api(account, "GET", "/contacts/get", undefined, { id })); } catch (e) { return err(e); }
});

registerTool("sendpulse_get_contacts_by_tag", {
  title: "Get Contacts by Tag",
  description: "Get all contacts that have a specific tag.",
  inputSchema: { account: Account, bot_id: BotId, tag: z.string().describe("Tag name") },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, bot_id, tag }) => {
  try { return ok(await api(account, "GET", "/contacts/getByTag", undefined, { tag, bot_id })); } catch (e) { return err(e); }
});

registerTool("sendpulse_create_contact", {
  title: "Create Contact",
  description: "Create a new WhatsApp contact by phone number.",
  inputSchema: {
    account: Account,
    bot_id: BotId,
    phone: z.string().describe("Phone number with country code (e.g. 972501234567)"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ account, bot_id, phone }) => {
  try { return ok(await api(account, "POST", "/contacts", { phone, bot_id })); } catch (e) { return err(e); }
});

registerTool("sendpulse_send_message", {
  title: "Send Message to Contact",
  description: "Send a message to a contact. Only works within the 24-hour messaging window after the contact last messaged. Use sendpulse_send_template outside that window.",
  inputSchema: {
    account: Account,
    contact_id: z.string().describe("Contact ID"),
    message: z.object({
      type: z.enum(["text", "image", "document", "audio"]).describe("Message type"),
      text: z.string().optional().describe("Text content (for type=text)"),
      url: z.string().optional().describe("Media URL (for image/document/audio)"),
    }).describe("Message object"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ account, contact_id, message }) => {
  // SendPulse WhatsApp Cloud API expects nested payloads per type:
  // text -> { type:"text", text:{ body } }; media -> { type, <type>:{ link } }
  const payload = message.type === "text"
    ? { type: "text", text: { body: message.text } }
    : { type: message.type, [message.type]: { link: message.url } };
  try { return ok(await api(account, "POST", "/contacts/send", { contact_id, message: payload })); } catch (e) { return err(e); }
});

registerTool("sendpulse_send_template", {
  title: "Send Template to Contact",
  description: "Send a pre-approved WhatsApp template to a contact. Works outside the 24-hour window. Templates must be approved in Meta Business Manager.",
  inputSchema: {
    account: Account,
    contact_id: z.string().describe("Contact ID"),
    template_name: z.string().describe("Approved template name"),
    language_code: z.string().default("en_US").describe("Language code, e.g. en_US, he"),
    components: z.array(z.record(z.unknown())).optional().describe("Template components for variables/media"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ account, contact_id, template_name, language_code, components }) => {
  try {
    const template: Record<string, unknown> = { name: template_name, language: { code: language_code } };
    if (components?.length) template.components = components;
    return ok(await api(account, "POST", "/contacts/sendTemplate", { contact_id, template }));
  } catch (e) { return err(e); }
});

registerTool("sendpulse_send_template_by_phone", {
  title: "Send Template by Phone",
  description: "Send a pre-approved WhatsApp template directly by phone number without needing a contact ID.",
  inputSchema: {
    account: Account,
    bot_id: BotId,
    phone: z.string().describe("Phone number with country code"),
    template_name: z.string().describe("Approved template name"),
    language_code: z.string().default("en_US"),
    components: z.array(z.record(z.unknown())).optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ account, bot_id, phone, template_name, language_code, components }) => {
  try {
    const template: Record<string, unknown> = { name: template_name, language: { code: language_code } };
    if (components?.length) template.components = components;
    return ok(await api(account, "POST", "/contacts/sendTemplateByPhone", { bot_id, phone, template }));
  } catch (e) { return err(e); }
});

registerTool("sendpulse_set_contact_variable", {
  title: "Set Contact Variables",
  description: "Set one or more custom variables on a contact.",
  inputSchema: {
    account: Account,
    contact_id: z.string(),
    variables: z.array(z.object({
      id: z.string().optional().describe("Variable ID"),
      name: z.string().optional().describe("Variable name (use if no ID)"),
      value: z.unknown().describe("Value to set"),
    })).describe("Variables to set"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, contact_id, variables }) => {
  try { return ok(await api(account, "POST", "/contacts/setVariable", { contact_id, variables })); } catch (e) { return err(e); }
});

registerTool("sendpulse_set_contact_tags", {
  title: "Add Tags to Contact",
  description: "Add one or more tags to a contact.",
  inputSchema: {
    account: Account,
    contact_id: z.string(),
    tags: z.array(z.string()).describe("Tag names to add"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, contact_id, tags }) => {
  try { return ok(await api(account, "POST", "/contacts/setTag", { contact_id, tags })); } catch (e) { return err(e); }
});


registerTool("sendpulse_set_contact_name", {
  title: "Set Contact Name",
  description: "Update the display name of a WhatsApp contact in SendPulse.",
  inputSchema: {
    account: Account,
    contact_id: z.string(),
    name: z.string().describe("New display name for the contact"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, contact_id, name }) => {
  try { return ok(await api(account, "POST", "/contacts/setName", { contact_id, name })); } catch (e) { return err(e); }
});
registerTool("sendpulse_remove_contact_tag", {
  title: "Remove Tag from Contact",
  description: "Remove a specific tag from a contact.",
  inputSchema: {
    account: Account,
    contact_id: z.string(),
    tag: z.string().describe("Tag name to remove"),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
}, async ({ account, contact_id, tag }) => {
  try { return ok(await api(account, "POST", "/contacts/deleteTag", { contact_id, tag })); } catch (e) { return err(e); }
});

registerTool("sendpulse_pause_contact_automation", {
  title: "Pause Contact Automation",
  description: "Pause all automated flows for a contact for a specified number of minutes (e.g. while a human agent is handling the chat).",
  inputSchema: {
    account: Account,
    contact_id: z.string(),
    minutes: z.number().int().min(1).describe("Minutes to pause automation"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ account, contact_id, minutes }) => {
  try { return ok(await api(account, "POST", "/contacts/setPauseAutomation", { contact_id, minutes })); } catch (e) { return err(e); }
});

registerTool("sendpulse_resume_contact_automation", {
  title: "Resume Contact Automation",
  description: "Resume automated flows for a contact, cancelling any active pause.",
  inputSchema: { account: Account, contact_id: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, contact_id }) => {
  try { return ok(await api(account, "POST", "/contacts/deletePauseAutomation", { contact_id })); } catch (e) { return err(e); }
});

registerTool("sendpulse_disable_contact", {
  title: "Disable Contact",
  description: "Disable a contact so they stop receiving bot messages.",
  inputSchema: { account: Account, contact_id: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
}, async ({ account, contact_id }) => {
  try { return ok(await api(account, "POST", "/contacts/disable", { contact_id })); } catch (e) { return err(e); }
});

registerTool("sendpulse_enable_contact", {
  title: "Enable Contact",
  description: "Re-enable a previously disabled contact.",
  inputSchema: { account: Account, contact_id: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, contact_id }) => {
  try { return ok(await api(account, "POST", "/contacts/enable", { contact_id })); } catch (e) { return err(e); }
});

// ── CHATS ─────────────────────────────────────────────────────────────────────

registerTool("sendpulse_list_chats", {
  title: "List Chats",
  description: "List all active chats for a WhatsApp bot.",
  inputSchema: { account: Account, bot_id: BotId },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, bot_id }) => {
  try { return ok(await api(account, "GET", "/chats", undefined, { bot_id })); } catch (e) { return err(e); }
});

registerTool("sendpulse_get_chat_messages", {
  title: "Get Chat Messages",
  description: "Get message history for a contact.",
  inputSchema: {
    account: Account,
    contact_id: z.string(),
    size: z.number().int().min(1).max(100).default(20).describe("Number of messages to fetch"),
    skip: z.number().int().min(0).default(0).describe("Messages to skip (pagination)"),
    order: z.enum(["asc", "desc"]).default("desc").describe("Message order"),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, contact_id, size, skip, order }) => {
  try { return ok(await api(account, "GET", "/chats/messages", undefined, { contact_id, size, skip, order })); } catch (e) { return err(e); }
});

// ── FLOWS ─────────────────────────────────────────────────────────────────────

registerTool("sendpulse_list_flows", {
  title: "List Automation Flows",
  description: "List all automation flows configured for a bot.",
  inputSchema: { account: Account, bot_id: BotId },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, bot_id }) => {
  try { return ok(await api(account, "GET", "/flows", undefined, { bot_id })); } catch (e) { return err(e); }
});

registerTool("sendpulse_run_flow", {
  title: "Run Flow for Contact",
  description: "Trigger a specific automation flow for a contact.",
  inputSchema: {
    account: Account,
    contact_id: z.string(),
    flow_id: z.string().describe("Flow ID (from sendpulse_list_flows)"),
    external_data: z.record(z.unknown()).optional().describe("Dynamic variables to inject into the flow"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ account, contact_id, flow_id, external_data }) => {
  try {
    return ok(await api(account, "POST", "/flows/run", { contact_id, flow_id, ...(external_data && { external_data }) }));
  } catch (e) { return err(e); }
});

registerTool("sendpulse_run_flow_by_trigger", {
  title: "Run Flow by Trigger Keyword",
  description: "Trigger an automation flow for a contact using a keyword trigger.",
  inputSchema: {
    account: Account,
    contact_id: z.string(),
    trigger_keyword: z.string().describe("Keyword that activates the flow"),
    external_data: z.record(z.unknown()).optional().describe("Dynamic variables to inject"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ account, contact_id, trigger_keyword, external_data }) => {
  try {
    return ok(await api(account, "POST", "/flows/runByTrigger", { contact_id, trigger_keyword, ...(external_data && { external_data }) }));
  } catch (e) { return err(e); }
});

// ── CAMPAIGNS ────────────────────────────────────────────────────────────────

registerTool("sendpulse_send_campaign", {
  title: "Send Broadcast Campaign",
  description: "Send a broadcast message to all bot subscribers. Optionally schedule with send_at or filter recipients.",
  inputSchema: {
    account: Account,
    bot_id: BotId,
    title: z.string().describe("Campaign name for tracking"),
    messages: z.array(z.record(z.unknown())).describe("Array of message objects to send"),
    send_at: z.string().optional().describe("ISO 8601 datetime to schedule (omit to send immediately)"),
    filter: z.record(z.unknown()).optional().describe("Filter recipients by tags/variables"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ account, bot_id, title, messages, send_at, filter }) => {
  try {
    return ok(await api(account, "POST", "/campaigns/send", {
      title, bot_id, messages,
      ...(send_at && { send_at }),
      ...(filter && { filter }),
    }));
  } catch (e) { return err(e); }
});

registerTool("sendpulse_send_template_campaign", {
  title: "Send Template Campaign",
  description: "Send a pre-approved WhatsApp template to all bot subscribers as a campaign.",
  inputSchema: {
    account: Account,
    bot_id: BotId,
    title: z.string().describe("Campaign name for tracking"),
    template_name: z.string().describe("Approved template name"),
    language_code: z.string().default("en_US"),
    components: z.array(z.record(z.unknown())).optional().describe("Template components for variables/media"),
    send_at: z.string().optional().describe("ISO 8601 datetime to schedule"),
    filter: z.record(z.unknown()).optional().describe("Filter recipients"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ account, bot_id, title, template_name, language_code, components, send_at, filter }) => {
  try {
    const template: Record<string, unknown> = { name: template_name, language: { code: language_code } };
    if (components?.length) template.components = components;
    return ok(await api(account, "POST", "/campaigns/sendTemplate", {
      bot_id, title, template,
      ...(send_at && { send_at }),
      ...(filter && { filter }),
    }));
  } catch (e) { return err(e); }
});

// ── METADATA ─────────────────────────────────────────────────────────────────

registerTool("sendpulse_list_tags", {
  title: "List Tags",
  description: "List all contact tags defined for a bot.",
  inputSchema: { account: Account, bot_id: BotId },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, bot_id }) => {
  try { return ok(await api(account, "GET", "/tags", undefined, { bot_id })); } catch (e) { return err(e); }
});

registerTool("sendpulse_list_variables", {
  title: "List Contact Variables",
  description: "List all custom contact variables defined for a bot.",
  inputSchema: { account: Account, bot_id: BotId },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, bot_id }) => {
  try { return ok(await api(account, "GET", "/variables", undefined, { bot_id })); } catch (e) { return err(e); }
});

registerTool("sendpulse_list_triggers", {
  title: "List Flow Triggers",
  description: "List all keyword triggers configured for a bot's flows.",
  inputSchema: { account: Account, bot_id: BotId },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async ({ account, bot_id }) => {
  try { return ok(await api(account, "GET", "/triggers", undefined, { bot_id })); } catch (e) { return err(e); }
});

// ── MAIN ──────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`SendPulse MCP running. Accounts: ${accountNames.join(", ")}${READ_ONLY ? " (read-only)" : ""}`);
