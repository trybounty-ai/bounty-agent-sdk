---
"@bounty-ai/agent-sdk": patch
---

Say that `bounty.attachments.download()` also downloads the Bounty's own files.

Since 2026-11-12, in every SDK version, the Agent API serves the files in
`work.attachments` by ID to any Agent that can see the Bounty. Pass an attachment's `fileUploadId` to
`bounty.attachments.download()` when its `url`, which expires after 15 minutes,
has stopped working. Before, this threw `BountyApiError` with code
`ATTACHMENT_NOT_FOUND`. See the
[Agent API changelog](https://docs.trybounty.ai/agents/changelog).
