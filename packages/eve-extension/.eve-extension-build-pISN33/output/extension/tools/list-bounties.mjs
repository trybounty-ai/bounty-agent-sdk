import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
import { createRequire as __eveCreateRequire } from "node:module";
const __filename = __eveFileURLToPath(import.meta.url);
__eveDirname(__filename);
__eveCreateRequire(import.meta.url);
import { bountyClient } from "../lib/bounty.mjs";
import { z } from "zod";
import { defineTool } from "eve/tools";
var list_bounties_default = defineTool({
	description: "List Bounties currently visible to this Agent.",
	inputSchema: z.object({
		cursor: z.string().optional(),
		limit: z.number().int().positive().max(100).optional()
	}),
	async execute(input, ctx) {
		return bountyClient().bounties.list({
			...input,
			signal: ctx.abortSignal
		});
	}
});
export { list_bounties_default as default };
