# sendpulse-whatsapp-mcp

[![ci](https://github.com/lieox/sendpulse-whatsapp-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/lieox/sendpulse-whatsapp-mcp/actions/workflows/ci.yml)

An MCP server that lets Claude (Claude Code, Claude Desktop, or any MCP client) work with a **SendPulse WhatsApp chatbot**: read bots, contacts and chat history, send messages and approved templates, tag contacts, run flows and send campaigns.

26 tools, one or several SendPulse accounts, and a read-only mode for people who should look but not send.

## What you need

- Node.js 18 or newer, and git (npm installs the server straight from this repo)
- SendPulse API credentials: **Settings > API > Client credentials** ([direct link](https://login.sendpulse.com/settings/api)). Copy the **ID** and the **Secret**.

The credentials open the **whole SendPulse account**, not one bot. Anyone holding them can message every contact in it. Keep them out of chats, screenshots and git.

## Install in Claude Code

### Windows

Two lines, in PowerShell or Command Prompt:

```
npm install -g github:lieox/sendpulse-whatsapp-mcp
claude mcp add -e SENDPULSE_CLIENT_ID=your-id -e SENDPULSE_CLIENT_SECRET=your-secret -e SENDPULSE_READ_ONLY=1 -s user sendpulse cmd /c sendpulse-whatsapp-mcp
```

Why it looks like this:

- **Installed once, not through npx.** Fetching from GitHub with npx on the first start can take longer than the 30 seconds Claude Code waits for a server on Windows, and then the first connection fails. An installed server starts instantly and needs no network to start.
- **No `--` in the command.** When Claude Code itself was installed with npm, PowerShell swallows `--` and the command fails with `error: unknown option '-y'`. Keep `-s user` right before the name: `-e` accepts several values and stops only at the next option.
- **`cmd /c`** because Claude Code on Windows cannot start an npm command (`.cmd`) directly.

To update later, run the `npm install -g` line again.

### macOS

One line:

```bash
claude mcp add sendpulse -s user -e SENDPULSE_CLIENT_ID=your-id -e SENDPULSE_CLIENT_SECRET=your-secret -e SENDPULSE_READ_ONLY=1 -- npx -y github:lieox/sendpulse-whatsapp-mcp
```

### Then, on both

Restart Claude Code, run `/mcp`, and check that `sendpulse` shows as connected. Then ask: *"list my SendPulse bots"*.

Drop `-e SENDPULSE_READ_ONLY=1` when you want Claude to be able to send (remove the server first with `claude mcp remove sendpulse -s user`, then add it again).

### What CI checks

On every push, [GitHub Actions](.github/workflows/ci.yml) runs the commands above in a real Claude Code and requires `claude mcp get` to report **Connected**:

- Windows: PowerShell 7, Windows PowerShell 5.1 and Command Prompt, with Claude Code installed both natively and through npm
- macOS: zsh, with an empty npx cache (a true first run)

It also builds on both systems, checks that the committed `dist/` matches `src/`, and runs a smoke test of every mode against the real SendPulse API with fake credentials.

## Install in Claude Desktop

Not covered by CI.

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
npm run compile    # compiles src/ to dist/
npm test           # smoke test, no credentials needed
npm run dev        # watch mode
```

`dist/` is committed on purpose, so installing from GitHub needs no build step. Recompile and commit it with every change to `src/` (CI fails if they differ).

The compile script is deliberately **not** named `build`: npm treats a git dependency with a `build` script as needing preparation, installs TypeScript and the other dev tools into every user's install, and the first start becomes too slow for Claude Code on Windows.

## License

MIT
