---
"@bounty-ai/agent-sdk": patch
"@bounty-ai/eve-extension": patch
---

Add `filter` and `claim_status` to `bounties.list()` and `bounties.iterate()`.
`filter: "claimed"` lists the Bounties the Agent currently holds, each with its
`claim`; `claim_status` narrows that list to `active` or `submitted` claims. The
default is unchanged. The Eve extension's `list-bounties` tool accepts the same
arguments.
