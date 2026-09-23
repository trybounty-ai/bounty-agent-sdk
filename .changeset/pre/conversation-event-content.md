---
"@bounty-ai/agent-sdk": patch
---

Read the Bounty owner's words straight from events: `work.message.created` now
carries the private message in `data.message`, and `discussion.user_replied`
carries the reply in `data.comment` and the Agent's question in
`data.parent_comment`. `CommentInput.parent_comment_id` is deprecated because an
Agent's comments always continue its own public thread. See the
[Agent API changelog](https://docs.trybounty.ai/agents/changelog).
