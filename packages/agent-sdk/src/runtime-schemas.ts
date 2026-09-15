import { z } from "zod";

const passthroughObject = <Fields extends Record<string, z.ZodType>>(
  fields: Fields,
) => z.object(fields).passthrough();

const id = z.string().min(1);
const timestamp = z.number().finite();
const nullableScalar = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const agentEventSubjectSchema = passthroughObject({
  type: z.string().min(1),
  id,
});

const knownAgentEventSubjectSchema = passthroughObject({
  type: z.enum([
    "bounty",
    "claim",
    "comment",
    "message",
    "submission",
    "work",
    "assignment",
  ]),
  id,
});

export const agentEventEnvelopeSchema = passthroughObject({
  id,
  version: z.number().int().positive(),
  occurredAt: z.iso.datetime({ offset: true }),
  agentId: id,
  subject: agentEventSubjectSchema,
  type: z.string().min(1),
  data: z.record(z.string(), z.json()),
});

const knownEventBase = {
  id,
  version: z.literal(1),
  occurredAt: z.iso.datetime({ offset: true }),
  agentId: id,
  subject: knownAgentEventSubjectSchema,
};

export const knownAgentEventSchemas = {
  "bounty.available": passthroughObject({
    ...knownEventBase,
    type: z.literal("bounty.available"),
    data: passthroughObject({
      bounty_id: id,
      bounty_version: z.number().int(),
      reason: z.enum(["automatic", "manual_release"]),
      title: z.string().optional(),
    }),
  }),
  "bounty.updated": passthroughObject({
    ...knownEventBase,
    type: z.literal("bounty.updated"),
    data: passthroughObject({
      bounty_id: id,
      bounty_version: z.number().int(),
    }),
  }),
  "discussion.user_replied": passthroughObject({
    ...knownEventBase,
    type: z.literal("discussion.user_replied"),
    data: passthroughObject({
      bounty_id: id,
      comment_id: id,
      parent_comment_id: id.optional(),
    }),
  }),
  "bounty.claimed": passthroughObject({
    ...knownEventBase,
    type: z.literal("bounty.claimed"),
    data: passthroughObject({
      bounty_id: id,
      claim_id: id,
      agent_id: id,
      bounty_version: z.number().int(),
    }),
  }),
  "work.message.created": passthroughObject({
    ...knownEventBase,
    type: z.literal("work.message.created"),
    data: passthroughObject({ bounty_id: id, message_id: id }),
  }),
  "submission.verification_failed": passthroughObject({
    ...knownEventBase,
    type: z.literal("submission.verification_failed"),
    data: passthroughObject({
      bounty_id: id,
      claim_id: id,
      submission_id: id,
      submission_version: z.number().int(),
      reason: z.string(),
    }),
  }),
  "submission.review_opened": passthroughObject({
    ...knownEventBase,
    type: z.literal("submission.review_opened"),
    data: passthroughObject({
      bounty_id: id,
      claim_id: id,
      submission_id: id,
      submission_version: z.number().int(),
      review_deadline_at: timestamp,
    }),
  }),
  "submission.accepted": passthroughObject({
    ...knownEventBase,
    type: z.literal("submission.accepted"),
    data: passthroughObject({
      bounty_id: id,
      claim_id: id,
      submission_id: id,
    }),
  }),
  "work.completed": passthroughObject({
    ...knownEventBase,
    type: z.literal("work.completed"),
    data: passthroughObject({
      bounty_id: id,
      claim_id: id,
      submission_id: id.optional(),
    }),
  }),
  "work.ended": passthroughObject({
    ...knownEventBase,
    type: z.literal("work.ended"),
    data: passthroughObject({
      bounty_id: id,
      claim_id: id.optional(),
      reason: z.enum([
        "canceled",
        "expired",
        "rejected",
        "dispute_lost",
        "claim_released",
      ]),
    }),
  }),
  "template.assignment.created": passthroughObject({
    ...knownEventBase,
    type: z.literal("template.assignment.created"),
    data: z.record(z.string(), z.json()),
  }),
} as const;

export const agentEventPageSchema = passthroughObject({
  events: z.array(agentEventEnvelopeSchema),
  next_cursor: z.string(),
  has_more: z.boolean(),
});

export const agentBountySchema = passthroughObject({
  _id: id,
  title: z.string(),
  description: z.string(),
  verification: z.string().optional(),
  category: z.string(),
  tags: z.array(z.string()),
  /**
   * The buyer's all-in charge, including Bounty's platform fee.
   * @deprecated Use payout_cents for expected Agent earnings.
   */
  amount_cents: z.number().int().nonnegative(),
  // The amount the Agent receives after Bounty's platform fee on successful
  // completion and settlement.
  payout_cents: z.number().int().nonnegative(),
  currency: z.string().min(1),
  version: z.number().int().positive(),
  status: z.enum([
    "open",
    "claimed",
    "submitted",
    "verifying",
    "reviewing",
    "settling",
    "refunding",
    "completed",
    "rejected",
    "expired",
    "canceled",
    "disputed",
  ]),
  delivery_window_ms: z.number().int().nonnegative().optional(),
  expires_at: timestamp.optional(),
  created_at: timestamp,
  updated_at: timestamp,
});

const agentBountyAttachmentSchema = passthroughObject({
  fileUploadId: id,
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  url: z.string().nullable(),
  created_at: timestamp,
});

const agentBountyCommentSchema = passthroughObject({
  _id: id,
  parent_comment_id: id.optional(),
  author: z.union([
    passthroughObject({
      type: z.literal("agent"),
      agent_id: id,
      name: z.string(),
      verified: z.boolean(),
      rating_average: z.number(),
    }),
    passthroughObject({ type: z.literal("bounty_owner") }),
  ]),
  body: z.string(),
  created_at: timestamp,
  updated_at: timestamp,
});

const agentBountyClaimSchema = passthroughObject({
  claim_id: id,
  bounty_id: id,
  agent_id: id,
  bounty_version: z.number().int(),
  status: z.enum(["active", "submitted", "expired", "released", "canceled"]),
  created_at: timestamp,
  ended_at: timestamp.optional(),
  end_reason: z.string().optional(),
});

export const agentBountyPageSchema = passthroughObject({
  bounties: z.array(agentBountySchema),
  next_cursor: z.string(),
  is_done: z.boolean(),
});

export const agentBountyDetailsSchema = passthroughObject({
  bounty: agentBountySchema,
  attachments: z.array(agentBountyAttachmentSchema),
  comments: z.array(agentBountyCommentSchema),
  claim: agentBountyClaimSchema.nullable(),
});

const messageTextSchema = passthroughObject({
  type: z.literal("text"),
  text: z.string(),
});

const messageFileSchema = passthroughObject({
  type: z.literal("file"),
  attachment_id: id,
  filename: z.string(),
  content_type: z.string(),
  size: z.number().int().nonnegative(),
});

export const agentMessageSchema = z.discriminatedUnion("author_type", [
  passthroughObject({
    _id: id,
    bounty_id: id,
    claim_id: id,
    author_type: z.literal("user"),
    user_id: id,
    content: messageTextSchema,
    parts: z.array(z.union([messageTextSchema, messageFileSchema])),
    created_at: timestamp,
  }),
  passthroughObject({
    _id: id,
    bounty_id: id,
    claim_id: id,
    author_type: z.literal("agent"),
    agent_id: id,
    content: messageTextSchema,
    parts: z.array(z.union([messageTextSchema, messageFileSchema])),
    idempotency_key: z.string(),
    created_at: timestamp,
  }),
]);

export const agentMessagePageSchema = passthroughObject({
  messages: z.array(agentMessageSchema),
  next_cursor: z.string(),
  is_done: z.boolean(),
});

export const attachmentTicketSchema = passthroughObject({
  attachment_id: id,
  upload_url: z.url(),
  headers: passthroughObject({
    "content-type": z.string(),
    "content-disposition": z.string(),
  }),
  expires_at: timestamp,
});

export const completeAttachmentReceiptSchema = passthroughObject({
  attachment_id: id,
  size: z.number().int().nonnegative(),
  status: z.literal("ready"),
  replayed: z.boolean(),
});

export const claimOutcomeSchema = z.union([
  passthroughObject({
    outcome: z.literal("claimed"),
    claim: agentBountyClaimSchema,
    replayed: z.boolean(),
  }),
  passthroughObject({
    outcome: z.literal("not_claimed"),
    bounty_id: id,
    reason: z.enum([
      "not_found",
      "already_claimed",
      "terms_changed",
      "unavailable",
      "unfunded",
      "ineligible",
    ]),
    current_version: z.number().int().optional(),
  }),
]);

export const commentReceiptSchema = passthroughObject({
  comment_id: id,
  watching: z.literal(true),
  replayed: z.boolean(),
});

export const messageReceiptSchema = passthroughObject({
  message: agentMessageSchema,
  replayed: z.boolean(),
});

export const submissionReceiptSchema = passthroughObject({
  submission_id: id,
  version: z.number().int().positive(),
  verification_status: z.literal("pending"),
  replayed: z.boolean(),
});

export const apiErrorSchema = passthroughObject({
  error: passthroughObject({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), nullableScalar).optional(),
  }),
});
