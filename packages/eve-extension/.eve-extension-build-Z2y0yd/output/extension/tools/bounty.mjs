import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
import { createRequire as __eveCreateRequire } from "node:module";
const __filename = __eveFileURLToPath(import.meta.url);
__eveDirname(__filename);
__eveCreateRequire(import.meta.url);
import { bountyClient, bountyDetails } from "../lib/bounty.mjs";
import bounty_default$1 from "../channels/bounty.mjs";
import { isChannel } from "eve/channels";
import { z } from "zod";
import { defineDynamic, defineTool } from "eve/tools";
const sharedDeliverable = {
	key: z.string().min(1),
	label: z.string().min(1).optional(),
	mime_type: z.string().min(1).optional()
};
const deliverable = z.discriminatedUnion("type", [
	z.object({
		...sharedDeliverable,
		type: z.literal("text"),
		data: z.object({ text: z.string() })
	}),
	z.object({
		...sharedDeliverable,
		type: z.literal("table"),
		data: z.object({ rows: z.array(z.record(z.string(), z.union([
			z.string(),
			z.number(),
			z.boolean(),
			z.null()
		]))).min(1).max(500) })
	}),
	z.object({
		...sharedDeliverable,
		type: z.literal("image"),
		data: z.object({
			url: z.url(),
			filename: z.string().optional(),
			width: z.number().int().positive().optional(),
			height: z.number().int().positive().optional()
		})
	}),
	z.object({
		...sharedDeliverable,
		type: z.literal("file"),
		data: z.object({
			url: z.url(),
			filename: z.string().optional(),
			contentType: z.string().optional(),
			size: z.number().int().nonnegative().optional()
		})
	})
]);
const bountySubmissionInput = z.object({ deliverables: z.array(deliverable).min(1).max(50) });
const bountyCommentInput = z.object({ body: z.string().min(1).max(4e3) });
const bountyMessageInput = z.object({ text: z.string().min(1).max(4e3) });
const defaultDependencies = {
	open: (bountyId, options) => bountyClient().bounties.open(bountyId, options),
	details: bountyDetails,
	metadata: (channel) => isChannel(channel, bounty_default$1) ? channel.metadata : void 0
};
function createBountyTools(dependencies = defaultDependencies) {
	return defineDynamic({ events: { "session.started": (_event, ctx) => {
		const metadata = dependencies.metadata(ctx.channel);
		if (!metadata) return null;
		const { bountyId } = metadata;
		return {
			"get-bounty": defineTool({
				description: "Get this Bounty's current terms, public discussion, attachments, and Claim.",
				inputSchema: z.object({}),
				execute: (_input, tool) => dependencies.details(bountyId, tool.abortSignal)
			}),
			"claim-bounty": defineTool({
				description: "Claim this Bounty at its current version. Returns claimed, or not_claimed with a reason.",
				inputSchema: z.object({}),
				async execute(_input, tool) {
					return (await dependencies.open(bountyId, { signal: tool.abortSignal })).claim({ signal: tool.abortSignal });
				}
			}),
			"post-comment": defineTool({
				description: "Post in your public thread on this Bounty. Your first comment starts it, later comments continue it, and the Bounty owner replies in it. Anyone can read it.",
				inputSchema: bountyCommentInput,
				async execute({ body }, tool) {
					return (await dependencies.open(bountyId, { signal: tool.abortSignal })).comment({
						body,
						idempotency_key: `eve:${tool.callId}:comment`,
						signal: tool.abortSignal
					});
				}
			}),
			"list-messages": defineTool({
				description: "Read the private Work Conversation with this Bounty's owner, newest first. Available after you claim the Bounty.",
				inputSchema: z.object({
					cursor: z.string().optional(),
					limit: z.number().int().positive().max(100).optional()
				}),
				async execute({ cursor, limit }, tool) {
					const work = await dependencies.open(bountyId, { signal: tool.abortSignal });
					const messages = [];
					for await (const message of work.messages({
						cursor,
						limit,
						signal: tool.abortSignal
					})) messages.push(message);
					return { messages };
				}
			}),
			"send-message": defineTool({
				description: "Send a private message to this Bounty's owner in the Work Conversation. Available after you claim the Bounty.",
				inputSchema: bountyMessageInput,
				async execute({ text }, tool) {
					return (await dependencies.open(bountyId, { signal: tool.abortSignal })).sendMessage({
						text,
						idempotency_key: `eve:${tool.callId}:message`,
						signal: tool.abortSignal
					});
				}
			}),
			"submit-bounty": defineTool({
				description: "Submit your completed deliverables for this Bounty.",
				inputSchema: bountySubmissionInput,
				async execute({ deliverables }, tool) {
					const work = await dependencies.open(bountyId, { signal: tool.abortSignal });
					const normalized = deliverables.map((item) => {
						const common = { key: item.key };
						if (item.label !== void 0) common.label = item.label;
						if (item.mime_type !== void 0) common.mime_type = item.mime_type;
						if (item.type === "text") return {
							...common,
							type: item.type,
							data: item.data
						};
						if (item.type === "table") return {
							...common,
							type: item.type,
							data: item.data
						};
						if (item.type === "image") {
							const data = { url: item.data.url };
							if (item.data.filename !== void 0) data.filename = item.data.filename;
							if (item.data.width !== void 0) data.width = item.data.width;
							if (item.data.height !== void 0) data.height = item.data.height;
							return {
								...common,
								type: item.type,
								data
							};
						}
						const data = { url: item.data.url };
						if (item.data.filename !== void 0) data.filename = item.data.filename;
						if (item.data.contentType !== void 0) data.contentType = item.data.contentType;
						if (item.data.size !== void 0) data.size = item.data.size;
						return {
							...common,
							type: item.type,
							data
						};
					});
					return work.submit({
						deliverables: normalized,
						idempotency_key: `eve:${tool.callId}:submission`,
						signal: tool.abortSignal
					});
				}
			})
		};
	} } });
}
var bounty_default = createBountyTools();
export { bountyCommentInput, bountyMessageInput, bountySubmissionInput, createBountyTools, bounty_default as default };
