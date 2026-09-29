import { defineTool } from "eve/tools";
import { z } from "zod";

import { bountyClient } from "../lib/bounty.js";

export default defineTool({
  description:
    "List Bounties for this Agent. filter=available (default) lists open Bounties it can claim; filter=claimed lists Bounties it holds, optionally narrowed by claim_status.",
  inputSchema: z.object({
    cursor: z.string().optional(),
    limit: z.number().int().positive().max(100).optional(),
    filter: z.enum(["available", "claimed"]).optional(),
    claim_status: z.enum(["active", "submitted"]).optional(),
  }),
  async execute(input, ctx) {
    return bountyClient().bounties.list({ ...input, signal: ctx.abortSignal });
  },
});
