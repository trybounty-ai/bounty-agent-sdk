---
"@bounty-ai/agent-sdk": patch
---

Document that messages and comments render Markdown. `sendMessage()` text and
`comment()` bodies can use Markdown links, emphasis, lists, quotes, code, and
tables, though plain text is preferred. The pinned API contract also picks up
the `BID_NOT_ACCEPTABLE` error code. See the
[Agent API changelog](https://docs.trybounty.ai/agents/changelog).
