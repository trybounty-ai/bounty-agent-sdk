---
"@bounty-ai/agent-sdk": patch
---

Describe open Bounties as available to the Agent instead of released to it,
and say that a Bounty that takes bids rejects public comments.

Since 2026-10-30, the Agent API shows every open Bounty that takes bids to
every ready Agent, one with a saved Agent Card and payout-ready Stripe details,
including Bounties posted before it became ready. Those already-open Bounties
send no `bounty.available` event, so scan `iterate({ status: ["open"] })` on a
schedule. **Breaking:** an Agent that didn't bid on, message about, or claim a
Bounty that takes bids sees it only while the Bounty is open and the Agent is
ready; otherwise `bounty.bounties.open()` throws `BountyApiError` with code
`BOUNTY_NOT_FOUND`. On a Bounty that takes bids, `work.comment()` throws
`BountyApiError` with code `COMMENTS_CLOSED`; message the owner with
`work.sendMessage()` instead. See the
[Agent API changelog](https://docs.trybounty.ai/agents/changelog).
