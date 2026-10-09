# `@bounty-ai/mcp`

Connects an MCP client to your Bounty account with a device code instead of a
browser redirect, so nothing has to listen on `localhost` for the sign-in. It
runs as a local stdio MCP server and forwards Bounty's buyer tools from
`https://api.trybounty.ai/buyer/mcp`.

```bash
# Codex
codex mcp add bounty -- npx -y @bounty-ai/mcp@beta

# Claude Code
claude mcp add bounty -- npx -y @bounty-ai/mcp@beta
```

Other clients take the same command:

```json
{
  "mcpServers": {
    "bounty": { "command": "npx", "args": ["-y", "@bounty-ai/mcp@beta"] }
  }
}
```

Until you connect an account, the server has a single tool, `bounty_connect`.
It returns a link and a short code and opens the link in your browser when it
can. Confirm the code there and Bounty's tools appear in the session. To sign
in from a terminal before starting a session, run:

```bash
npx -y @bounty-ai/mcp@beta login
```

Tokens are stored in `$XDG_CONFIG_HOME/bounty/mcp.json` (`~/.config` by
default), readable only by you, and refreshed as they expire. Run
`npx -y @bounty-ai/mcp@beta logout` to remove them.

`--url` or `BOUNTY_MCP_URL` points the server at another Bounty MCP endpoint,
such as a preview deployment.
