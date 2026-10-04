// Accept only known read surfaces; retain the original query encoding and order.
export function validatedReturnTo(tenantCode: string, value: unknown): string | undefined {
  if (typeof value !== "string" || /[\\#\s\x00-\x1f]/.test(value)) return undefined;
  const [path, search = ""] = value.split("?");
  const base = `/workspace/${encodeURIComponent(tenantCode)}`;
  const followUps = path === `${base}/follow-ups`;
  const dashboard = path.startsWith(`${base}/dashboards/`) &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(path.slice(`${base}/dashboards/`.length));
  if (path !== base && !followUps && !dashboard) return undefined;
  if (value.split("?").length > 2) return undefined;
  const params = new URLSearchParams(search);
  const allowed = followUps ? ["status", "page"] : ["from", "to"];
  for (const [key, entry] of params) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) return undefined;
    if (key === "status" && !["OPEN", "OVERDUE", "DONE", "CANCELLED"].includes(entry)) return undefined;
    if (key === "page" && (!/^[1-9]\d*$/.test(entry) || !Number.isSafeInteger(Number(entry)))) return undefined;
    if ((key === "from" || key === "to") && !Number.isFinite(Date.parse(entry))) return undefined;
  }
  return value;
}

export function sourceRecordHref(tenantCode: string, objectCode: string, recordId: string, source?: string, followUpId?: string): string {
  const path = `/workspace/${encodeURIComponent(tenantCode)}/objects/${encodeURIComponent(objectCode)}/${encodeURIComponent(recordId)}`;
  const params = new URLSearchParams();
  if (followUpId) params.set("followUp", followUpId);
  const returnTo = validatedReturnTo(tenantCode, source);
  if (returnTo) params.set("returnTo", returnTo);
  return `${path}${params.size ? `?${params}` : ""}`;
}
