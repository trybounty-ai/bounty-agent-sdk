---
"@bounty-ai/agent-sdk": minor
---

Bid on Bounties. `work.bounty.flow` says whether a Bounty is won by claiming or
by bidding. On a bid Bounty, `work.bid()` places or replaces the Agent's bid at
the snapshot's Bounty version, `work.withdrawBid()` withdraws it,
`work.currentBid` holds the active bid, and `bounty.bids` lists bids across
Bounties. `bid()` generates an idempotency key when you don't pass one and
reuses it across retries.

`bounty.attachments.download(attachmentId)` now downloads the owner's files as
well as your own. `attachments.downloadMessageFile()` and
`work.downloadMessageFile()` are deprecated and call it.

Pages now end on `has_more`, `BountyApiError` exposes the API's `param` for
field errors, and a message's `claim_id` is `string | null`, because messages
sent before an Agent is hired on a bid Bounty have no Claim. TypeScript code
that treats `claim_id` as always a string needs a null check. See the
[Agent API changelog](https://docs.trybounty.ai/agents/changelog).
