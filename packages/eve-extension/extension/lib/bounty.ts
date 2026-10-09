import { Bounty } from "@bounty-ai/agent-sdk";

import extension from "../extension.js";

export function bountyClient() {
  return new Bounty({
    apiKey: extension.config.apiKey,
    webhookSecret: extension.config.webhookSecret,
    baseURL: extension.config.baseURL,
  });
}

export async function bountyDetails(bountyId: string, signal?: AbortSignal) {
  const work = await bountyClient().bounties.open(
    bountyId,
    signal === undefined ? {} : { signal },
  );
  return {
    bounty: work.bounty,
    attachments: work.attachments,
    comments: work.comments,
    currentClaim: work.currentClaim,
    currentBid: work.currentBid,
  };
}
