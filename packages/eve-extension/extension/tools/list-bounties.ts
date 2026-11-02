import { defineTool } from "eve/tools";
import { z } from "zod";

import { bountyClient } from "../lib/bounty.js";

export default defineTool({
  description:
    "List the Bounties this Agent can see: the open Bounties available to it, then the Bounties it holds the Claim on, each with its claim.",
  inputSchema: z.object({
    cursor: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
    status: z
      .array(
        z.enum([
          "open",
          "claimed",
          "submitted",
          "reviewing",
          "settling",
          "refunding",
          "completed",
          "rejected",
          "expired",
          "canceled",
          "disputed",
        ]),
      )
      .min(1)
      .optional()
      .describe(
        'Bounty statuses to list. open matches the open Bounties available to this Agent; any other status matches the Bounties it holds the Claim on, such as ["claimed", "submitted", "reviewing", "settling", "disputed"] for work in progress. Omit to list both.',
      ),
  }),
  async execute(input, ctx) {
    return bountyClient().bounties.list({ ...input, signal: ctx.abortSignal });
  },
});
