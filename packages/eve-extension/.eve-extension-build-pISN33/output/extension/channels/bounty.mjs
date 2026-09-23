import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
import { createRequire as __eveCreateRequire } from "node:module";
const __filename = __eveFileURLToPath(import.meta.url);
__eveDirname(__filename);
__eveCreateRequire(import.meta.url);
import { bountyClient } from "../lib/bounty.mjs";
import { BountyWebhookError, formatAgentEvent, getBountyId, isAgentEvent } from "@bounty-ai/agent-sdk";
import { POST, defineChannel } from "eve/channels";
import { z } from "zod";
const eventTitleSchema = z.string().min(1);
const BOUNTY_FILE_URL_PROTOCOL = "bounty-file:";
const MAX_HANDLED_EVENTS = 1e4;
const defaultDependencies = {
	verify: (request) => bountyClient().webhooks.verify(request),
	downloadMessageFile: (messageId, attachmentId, options) => bountyClient().attachments.downloadMessageFile(messageId, attachmentId, options)
};
function bountyFileUrl(messageId, attachmentId) {
	return new URL(`${BOUNTY_FILE_URL_PROTOCOL}${encodeURIComponent(messageId)}/${encodeURIComponent(attachmentId)}`);
}
function parseBountyFileUrl(value) {
	if (!value.startsWith(BOUNTY_FILE_URL_PROTOCOL)) return null;
	const [messageId, attachmentId, ...rest] = value.slice(12).split("/");
	if (!messageId || !attachmentId || rest.length > 0) return null;
	return {
		messageId: decodeURIComponent(messageId),
		attachmentId: decodeURIComponent(attachmentId)
	};
}
function turnMessage(event) {
	const text = formatAgentEvent(event);
	if (!isAgentEvent(event, "work.message.created") || !event.data.message) return text;
	const messageId = event.data.message_id;
	const files = event.data.message.parts.flatMap((part) => part.type === "file" ? [{
		type: "file",
		data: bountyFileUrl(messageId, part.attachment_id),
		filename: part.filename,
		mediaType: part.content_type
	}] : []);
	return files.length === 0 ? text : [{
		type: "text",
		text
	}, ...files];
}
function createBountyChannel(dependencies = defaultDependencies) {
	const handledEventIds = new Set();
	return defineChannel({
		state: {
			agentId: "",
			bountyId: ""
		},
		metadata: ({ agentId, bountyId }) => ({
			agentId,
			bountyId
		}),
		async fetchFile(url) {
			const file = parseBountyFileUrl(url);
			if (!file) return null;
			const response = await dependencies.downloadMessageFile(file.messageId, file.attachmentId);
			if (!response.ok) throw new Error(`Bounty file download returned HTTP ${response.status}`);
			const bytes = Buffer.from(await response.arrayBuffer());
			const mediaType = response.headers.get("content-type");
			return mediaType ? {
				bytes,
				mediaType
			} : { bytes };
		},
		routes: [POST("/webhooks/bounty", async (request, { from }) => {
			try {
				const event = await dependencies.verify(request);
				const bountyId = getBountyId(event);
				if (!bountyId) return Response.json({
					accepted: true,
					ignored: true
				}, { status: 202 });
				if (handledEventIds.has(event.id)) return Response.json({
					accepted: true,
					duplicate: true
				}, { status: 202 });
				handledEventIds.add(event.id);
				if (handledEventIds.size > MAX_HANDLED_EVENTS) for (const eventId of handledEventIds) {
					if (handledEventIds.size <= MAX_HANDLED_EVENTS / 2) break;
					handledEventIds.delete(eventId);
				}
				const address = [
					"agent",
					encodeURIComponent(event.agentId),
					"bounty",
					encodeURIComponent(bountyId)
				].join(":");
				const parsedTitle = eventTitleSchema.safeParse(event.data.title);
				let session;
				try {
					session = await from(address).send(turnMessage(event), {
						auth: null,
						state: {
							agentId: event.agentId,
							bountyId
						},
						title: parsedTitle.success ? parsedTitle.data : `Bounty ${bountyId}`
					});
				} catch (error) {
					handledEventIds.delete(event.id);
					throw error;
				}
				return Response.json({
					accepted: true,
					sessionId: session.id
				}, { status: 202 });
			} catch (error) {
				if (error instanceof BountyWebhookError) {
					const status = error.reason === "payload_too_large" ? 413 : error.reason === "invalid_signature" || error.reason === "invalid_signature_format" || error.reason === "timestamp_out_of_tolerance" ? 401 : 400;
					return Response.json({
						error: "invalid_bounty_webhook",
						reason: error.reason
					}, { status });
				}
				throw error;
			}
		})]
	});
}
var bounty_default = createBountyChannel();
export { createBountyChannel, bounty_default as default };
