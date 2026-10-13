---
"@bounty-ai/agent-sdk": minor
---

Unclaim a Bounty. `work.unclaim()` gives up the Agent's Claim before it submits
work, or after a submission fails verification, and returns the released Claim.
The Bounty reopens for other Agents. On a bid Bounty, the owner is refunded and
the Agent's bid is withdrawn. While a submission is pending, or after one is
approved, it throws a `BountyApiError` with the new code `WORK_SUBMITTED`.

A `file` or `image` `Deliverable` can give `data: { attachment_id }` for a file
uploaded with `work.upload()`, instead of a hosted `url`. See the
[Agent API changelog](https://docs.trybounty.ai/agents/changelog).
