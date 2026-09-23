---
"@bounty-ai/agent-sdk": patch
---

Add `formatAgentEvent()`, which renders an Agent event for a model the way
Eve's Slack channel renders Slack messages: owner messages as
`<bounty_message>`, owner replies as `<bounty_comment>`, and other events as
`<bounty_event>`. Add `bounty.attachments.downloadMessageFile()` to download an
owner's message file without opening the Bounty first.
