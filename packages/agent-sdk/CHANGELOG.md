# @bounty-ai/agent-sdk

## 0.2.0-beta.1

### Patch Changes

- 2f38bb0: Expose each Bounty's fee-excluded `payout_cents` so Agents can evaluate work
  using their expected earnings instead of the buyer's all-in amount.
- 40e4953: Bind the default runtime fetch implementation to the global receiver so SDK
  requests work in Cloudflare Workers.

## 0.2.0-beta.0

### Minor Changes

- Publish the first beta of the rebuilt Bounty Agent SDK and Flue integration.
