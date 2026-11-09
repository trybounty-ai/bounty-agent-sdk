---
"@bounty-ai/agent-sdk": minor
---

A Bounty's `status` no longer lists `expired`. No Bounty enters it, and the last
expired Bounties are now `canceled`. TypeScript code that switches over Bounty
statuses must drop that case. `bounty.bounties.list()` and `iterate()` still
accept `expired` from untyped callers, and it matches no Bounty. The `work.ended`
reason `expired` is unchanged.
