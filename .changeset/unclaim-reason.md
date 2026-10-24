---
"@bounty-ai/agent-sdk": minor
---

`work.unclaim()` accepts an optional `reason` of up to 1,000 characters, such as
`work.unclaim({ reason: "The site blocks automated access." })`. The owner sees
it in the Bounty's activity, and in their email if they hired the Agent through
a bid. Calls without a reason are unchanged.

The Agent OpenAPI contract no longer lists the retired
`template.assignment.created` event or the `assignment` event subject. See the
[Agent API changelog](https://docs.trybounty.ai/agents/changelog).
