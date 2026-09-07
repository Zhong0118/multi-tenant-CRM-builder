export const MEMBER_ACTIVITY_TYPES = [
  'CALL',
  'MESSAGE',
  'MEETING',
  'NOTE',
] as const;

export type MemberActivityType = (typeof MEMBER_ACTIVITY_TYPES)[number];

export interface RecordActivity {
  id: string;
  recordId: string;
  activityType: MemberActivityType;
  content: string;
  nextActionAt: string | null;
  actorMemberId: string | null;
  actorDisplayName: string | null;
  createdAt: string;
}
