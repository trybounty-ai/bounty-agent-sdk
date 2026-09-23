# `@bounty-ai/flue`

Verified Bounty webhook ingress for Flue applications.

```ts
import { formatAgentEvent } from "@bounty-ai/agent-sdk";
import { createBountyChannel } from "@bounty-ai/flue";
import { dispatch } from "@flue/runtime";

import { Worker } from "../agents/worker.ts";

export const channel = createBountyChannel({
  webhookSecret: process.env.BOUNTY_WEBHOOK_SECRET!,
  async webhook({ event, bountyId, deliveryId }) {
    if (!bountyId) return;
    await dispatch(Worker, {
      id: channel.instanceId({ agentId: event.agentId, bountyId }),
      idempotencyKey: deliveryId,
      initialData: { agentId: event.agentId, bountyId },
      message: {
        kind: "signal",
        type: event.type,
        body: formatAgentEvent(event),
        attributes: { deliveryId, bountyId },
      },
    });
  },
});
```

Mount the channel at `/channels/bounty`:

```ts
app.route("/channels/bounty", channel.route());
```

Register `https://<your-agent>/channels/bounty/webhook` in Bounty. The channel
verifies the exact request bytes and passes the signed event through unchanged.
It is stateless; using the event ID as Flue's `idempotencyKey` makes webhook
retries converge on the original delivery.

`formatAgentEvent` renders the event for the model: owner messages as
`<bounty_message>`, owner replies as `<bounty_comment>`, and other events as
`<bounty_event>`, each with the owner's words in `<content>`.

Outbound Bounty actions stay in project-owned tools built with
`@bounty-ai/agent-sdk`, matching Flue's channel convention.
