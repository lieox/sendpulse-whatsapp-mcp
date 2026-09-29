# sendpulse-whatsapp-mcp

An MCP server that lets Claude (Claude Code, Claude Desktop, or any MCP client) work with a **SendPulse WhatsApp chatbot**: read bots, contacts and chat history, send messages and approved templates, tag contacts, run flows and send campaigns.

26 tools, one or several SendPulse accounts, and a read-only mode for people who should look but not send.

## What you need

- Node.js 18 or newer, and git (npx fetches the server straight from this repo)
- SendPulse API credentials: **Settings > API > Client credentials** ([direct link](https://login.sendpulse.com/settings/api)). Copy the **ID** and the **Secret**.

The credentials open the **whole SendPulse account**, not one bot. Anyone holding them can message every contact in it. Keep them out of chats, screenshots and git.

## Install

### Claude Code

```bash
claude mcp add sendpulse -s user \
  -e SENDPULSE_CLIENT_ID=your-id \
  -e SENDPULSE_CLIENT_SECRET=your-secret \
  -e SENDPULSE_READ_ONLY=1 \
  -- npx -y github:lieox/sendpulse-whatsapp-mcp
```

Restart Claude Code, run `/mcp`, and check that `sendpulse` shows as connected. Then ask: *"list my SendPulse bots"*.

Drop `-e SENDPULSE_READ_ONLY=1` when you want Claude to be able to send.

On native Windows (not WSL), wrap npx: `-- cmd /c npx -y github:lieox/sendpulse-whatsapp-mcp`.

### Claude Desktop

Settings > Developer > Edit Config, then add:

```json
{
  "mcpServers": {
    "sendpulse": {
      "command": "npx",
      "args": ["-y", "github:lieox/sendpulse-whatsapp-mcp"],
      "env": {
        "SENDPULSE_CLIENT_ID": "your-id",
        "SENDPULSE_CLIENT_SECRET": "your-secret",
        "SENDPULSE_READ_ONLY": "1"
      }
    }
  }
}
```

Quit Claude Desktop completely and open it again.

## Configuration

| Variable | Meaning |
|---|---|
| `SENDPULSE_CLIENT_ID` + `SENDPULSE_CLIENT_SECRET` | One account. The tools use it automatically, no account name needed. |
| `SENDPULSE_ACCOUNTS` | Several accounts, as JSON: `{"brand_a":{"id":"...","secret":"..."},"brand_b":{...}}`. Every tool then takes an `account` argument. Ignored when the two variables above are set. |
| `SENDPULSE_READ_ONLY` | `1` exposes only the 10 read tools. Sending, tagging, flows and campaigns are not registered at all, so Claude cannot call them. |

## Tools

| Area | Read (always on) | Write (off in read-only mode) |
|---|---|---|
| Bots | `list_bots`, `get_bot_stats` | |
| Contacts | `get_contact`, `get_contacts_by_tag` | `create_contact`, `set_contact_name`, `set_contact_variable`, `set_contact_tags`, `remove_contact_tag`, `disable_contact`, `enable_contact`, `pause_contact_automation`, `resume_contact_automation` |
| Messages | `list_chats`, `get_chat_messages` | `send_message`, `send_template`, `send_template_by_phone` |
| Flows | `list_flows`, `list_triggers` | `run_flow`, `run_flow_by_trigger` |
| Campaigns | | `send_campaign`, `send_template_campaign` |
| Metadata | `list_tags`, `list_variables` | |

Every tool name starts with `sendpulse_`.

## Things WhatsApp enforces, not this server

- `send_message` only works within 24 hours of the contact's last message. Outside that window, use an approved template (`send_template`).
- Templates must be approved in Meta first, and Meta charges for template messages.
- `send_campaign` and `send_template_campaign` go to **every subscriber of the bot** unless you pass a `filter`. Ask Claude to show you the exact payload before it sends one.
- The SendPulse API allows 10 requests per second.

## Development

```bash
npm install
npm run build      # compiles src/ to dist/
npm run dev        # watch mode
```

`dist/` is committed on purpose, so `npx github:...` runs without a build step. Rebuild and commit it with every change to `src/`.

## License

MIT
