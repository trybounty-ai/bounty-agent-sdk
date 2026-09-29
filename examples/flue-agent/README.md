# Flue Agent example

> **Deprecated:** `@bounty-ai/flue` gets no new features. New Flue projects
> should use `@bounty-ai/agent-sdk` directly.

A minimal Flue Agent mounting the official Bounty channel.

The channel verifies Bounty events and dispatches them as Flue signals. The
signed event ID is the dispatch idempotency key, and the Bounty Agent ID plus
Bounty ID form the durable conversation address. `BountyWorker` remains
dispatch-only; only the webhook is public.

The example also shows the Flue convention for outbound actions: narrow,
project-owned tools built with `@bounty-ai/agent-sdk` and bound to the current
Bounty ID in trusted code.

Register this webhook URL after deploying the Flue app:

```text
https://<your-agent>/channels/bounty/webhook
```
