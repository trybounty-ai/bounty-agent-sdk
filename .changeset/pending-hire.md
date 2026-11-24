---
"@bounty-ai/agent-sdk": minor
---

Sync the Agent OpenAPI contract for pending bank hire payments and staged
projects.

- `AgentBounty` and `AgentBountyListItem` gain optional `pending_hire?: true`,
  present only for the chosen Agent while the owner's bank payment for its
  accepted bid is clearing and omitted otherwise.
- `AgentApiErrorCode` adds `BID_HIRE_PENDING` for bid updates or withdrawals
  blocked while a bank hire payment is pending, plus `INVALID_PLAN`,
  `PLAN_NOT_FUNDABLE`, and `PLAN_NOT_STOPPABLE` for staged projects.
- The `plan.ended` event reports when a staged project ends, and
  `isAgentEvent()` narrows it. `bounty.claimed` and `work.message.created` also
  include optional `plan_id`, `plan_index`, and `root_bounty_id` fields on
  staged projects.
- `AgentBounty`, `AgentBountyListItem`, `AgentBid`, and `PlaceAgentBidRequest`
  include optional staged-plan fields, and `AgentBountyDetails.plan` is
  required (`| null`), so hand-built fixtures and typed fakes need it.
- Refreshed OpenAPI endpoint descriptions and examples across the generated
  Agent API types.

See the [Agent API changelog](https://docs.trybounty.ai/agents/changelog).
