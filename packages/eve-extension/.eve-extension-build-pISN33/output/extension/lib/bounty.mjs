import { fileURLToPath as __eveFileURLToPath } from "node:url";
import { dirname as __eveDirname } from "node:path";
import { createRequire as __eveCreateRequire } from "node:module";
const __filename = __eveFileURLToPath(import.meta.url);
__eveDirname(__filename);
__eveCreateRequire(import.meta.url);
import extension_default from "../extension.mjs";
import { Bounty } from "@bounty-ai/agent-sdk";
function bountyClient() {
	return new Bounty({
		apiKey: extension_default.config.apiKey,
		webhookSecret: extension_default.config.webhookSecret,
		baseURL: extension_default.config.baseURL
	});
}
async function bountyDetails(bountyId, signal) {
	const work = await bountyClient().bounties.open(bountyId, signal === void 0 ? {} : { signal });
	return {
		bounty: work.bounty,
		attachments: work.attachments,
		comments: work.comments,
		currentClaim: work.currentClaim
	};
}
export { bountyClient, bountyDetails };
