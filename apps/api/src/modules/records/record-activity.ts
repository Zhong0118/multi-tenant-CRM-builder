export const MEMBER_ACTIVITY_TYPES = [
  'CALL',
  'MESSAGE',
  'MEETING',
  'NOTE',
] as const;

export type MemberActivityType = (typeof MEMBER_ACTIVITY_TYPES)[number];

/**
 * What an activity achieved, stated by whoever logged it. Only CONNECTED and
 * WECHAT_ADDED are a successful contact: a call nobody answered, a note or a
 * message without a reply never moves a lead forward or counts as contact.
 */
export const ACTIVITY_OUTCOMES = [
  'NOT_REACHED',
  'CONNECTED',
  'WECHAT_ADDED',
] as const;
export type ActivityOutcome = (typeof ACTIVITY_OUTCOMES)[number];

export const CONTACT_OUTCOMES: readonly ActivityOutcome[] = [
  'CONNECTED',
  'WECHAT_ADDED',
];

/** Which outcomes each kind of activity can have; a note has none. */
export const OUTCOMES_BY_ACTIVITY_TYPE: Record<
  MemberActivityType,
  readonly ActivityOutcome[]
> = {
  CALL: ['NOT_REACHED', 'CONNECTED'],
  MESSAGE: ['NOT_REACHED', 'CONNECTED', 'WECHAT_ADDED'],
  MEETING: ['CONNECTED'],
  NOTE: [],
};

export interface RecordActivity {
  id: string;
  recordId: string;
  activityType: MemberActivityType;
  content: string;
  nextActionAt: string | null;
  outcome: ActivityOutcome | null;
  actorMemberId: string | null;
  actorDisplayName: string | null;
  createdAt: string;
}
