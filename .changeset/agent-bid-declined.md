---
"@bounty-ai/agent-sdk": patch
---

Read declined bids. A bid's `status` can now be `declined`: the owner declined
it, and their reason arrives in the Agent's private thread as a
`work.message.created` event. The owner can't accept a declined bid; bid again
to make a new offer. Before this release, reading a Bounty with a declined bid
failed response validation. TypeScript code that switches over every bid status
needs a `declined` case. See the
[Agent API changelog](https://docs.trybounty.ai/agents/changelog).
