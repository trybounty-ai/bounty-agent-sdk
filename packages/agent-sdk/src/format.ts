import { getBountyId, isAgentEvent } from "./events.js";
import type { AgentEvent, AgentMessage } from "./types.js";

type Field = readonly [string, string];

function formatBlock(
  tag: string,
  fields: readonly Field[],
  sections: readonly Field[],
) {
  return [
    `<${tag}>`,
    ...fields.map(([key, value]) => `${key}: ${value}`),
    ...sections.flatMap(([section, body]) => [`<${section}>`, body, `</${section}>`]),
    `</${tag}>`,
  ].join("\n");
}

function messageSections(message: AgentMessage): Field[] {
  const text = message.parts
    .flatMap((part) => part.type === "text" ? [part.text] : [])
    .join("\n\n");
  const files = message.parts.flatMap((part) =>
    part.type === "file"
      ? [`- ${part.filename} (${part.content_type}, ${part.size} bytes, attachment_id: ${part.attachment_id})`]
      : []
  );
  return [
    ...(text ? [["content", text] as const] : []),
    ...(files.length > 0 ? [["attachments", files.join("\n")] as const] : []),
  ];
}

/**
 * Render an Agent event as a model-ready message, in the style of Eve's
 * `<slack_message>`: `key: value` header lines followed by tagged sections.
 * Owner messages become `<bounty_message>`, owner replies become
 * `<bounty_comment>`, and every other event becomes `<bounty_event>` with its
 * data as JSON.
 */
export function formatAgentEvent(event: AgentEvent): string {
  const bountyId = getBountyId(event);
  const bountyField: Field[] = bountyId ? [["bounty_id", bountyId]] : [];

  if (isAgentEvent(event, "work.message.created")) {
    const { message } = event.data;
    return formatBlock(
      "bounty_message",
      [
        ["audience", "private"],
        ...bountyField,
        ["event_id", event.id],
        ["message_id", event.data.message_id],
        ["sender_type", "bounty_owner"],
        ...(message
          ? []
          : [["content", "not included in this event; read the Bounty's private messages"] as const]),
      ],
      message ? messageSections(message) : [],
    );
  }
  if (isAgentEvent(event, "discussion.user_replied")) {
    const { comment, parent_comment: parentComment } = event.data;
    return formatBlock(
      "bounty_comment",
      [
        ["audience", "public"],
        ...bountyField,
        ["event_id", event.id],
        ["comment_id", event.data.comment_id],
        ...(event.data.parent_comment_id
          ? [["parent_comment_id", event.data.parent_comment_id] as const]
          : []),
        ["sender_type", "bounty_owner"],
        ...(comment
          ? []
          : [["content", "not included in this event; read the Bounty's public discussion"] as const]),
      ],
      [
        ...(parentComment ? [["in_reply_to", parentComment.body] as const] : []),
        ...(comment ? [["content", comment.body] as const] : []),
      ],
    );
  }
  return formatBlock(
    "bounty_event",
    [
      ["type", event.type],
      ...bountyField,
      ["event_id", event.id],
    ],
    [["data", JSON.stringify(event.data)]],
  );
}
