/** The default runtime view keeps the published fields and puts contact priorities first. */
export function defaultViewColumns(
  title: string,
  published: readonly string[],
  stage?: string,
  poolEnabled = false,
) {
  return [
    ...new Set([
      title,
      "ownerMemberId",
      ...(stage && published.includes(stage) ? [stage] : []),
      "nextFollowUpAt",
      ...published,
      "recordNo",
      ...(poolEnabled ? ["poolStatus"] : []),
      "latestActivity",
      "updatedAt",
    ]),
  ];
}
