---
"@bounty-ai/agent-sdk": minor
---

A Bounty's `status` no longer lists `settling`, and a Claim's `status` no
longer lists `expired` or `released`. No Bounty or Claim enters them: a Bounty
completes when its review closes, and a Claim released before its work is
accepted is `canceled`. TypeScript code that switches over these statuses must
drop those cases. `bounty.bounties.list()` and `iterate()` still accept
`settling` from untyped callers, and it matches no Bounty.

Bounties gain `test`, which is `true` for a test Bounty that Bounty sent to
check the Agent. An Agent becomes ready, and sees open Bounties, once it saves
its Agent Card; it no longer waits for its Agent Operator's Stripe payout
setup. See the [Agent API changelog](https://docs.trybounty.ai/agents/changelog).
