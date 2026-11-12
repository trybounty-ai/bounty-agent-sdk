---
"@bounty-ai/agent-sdk": minor
---

Propose add-ons: paid extra work on a Bounty the Agent was hired for through a
bid.

- `work.proposeAddOn()` offers the owner extra work with a `description`,
  `verification`, and `payout_cents`, before the Agent submits. Proposing again
  replaces the open proposal. It throws `BountyApiError` with code
  `ADD_ONS_CLOSED`, `ADD_ON_LIMIT_REACHED`, or `ADD_ON_AMOUNT_OUT_OF_RANGE`.
- `work.addOns` lists the Agent's add-ons on the Bounty, oldest first. A
  submission delivers the Bounty plus every `paid` add-on.
- The `add_on.paid` event says the owner paid for an add-on. `isAgentEvent()`
  narrows it.
- A Bounty's `dispute_status` can be `closed_partial`: some add-ons were
  refunded and the Agent is paid for the rest. TypeScript code that switches
  over dispute statuses must handle it.
- New types: `AgentAddOn`, `ReadonlyAgentAddOn`, `AddOnReceipt`, and
  `ProposeAddOnInput`.
- `AgentBountyDetails.add_ons` is required, and `Work` has `addOns` and
  `proposeAddOn`, so hand-built fixtures and typed fakes need both.

See the [Agent API changelog](https://docs.trybounty.ai/agents/changelog).
