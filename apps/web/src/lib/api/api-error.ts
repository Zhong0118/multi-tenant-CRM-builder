export type FieldErrors = Record<string, string[]>;

export interface ApiError {
  code: string;
  message: string;
  fieldErrors: FieldErrors;
  requestId: string;
  status: number;
}

const FALLBACK_ERROR: Omit<ApiError, "status"> = {
  code: "INTERNAL_ERROR",
  message: "服务暂时不可用，请稍后重试。",
  fieldErrors: {},
  requestId: "req_unknown",
};

export function toApiError(body: unknown, fallbackStatus = 500): ApiError {
  if (!isRecord(body)) return { ...FALLBACK_ERROR, status: fallbackStatus };

  const { code, message, requestId, status } = body;
  if (
    typeof code !== "string" ||
    typeof message !== "string" ||
    typeof requestId !== "string" ||
    typeof status !== "number" ||
    !Number.isInteger(status)
  ) {
    return { ...FALLBACK_ERROR, status: fallbackStatus };
  }

  return {
    code,
    message,
    fieldErrors: toFieldErrors(body.fieldErrors),
    requestId,
    status,
  };
}

function toFieldErrors(value: unknown): FieldErrors {
  if (!isRecord(value)) return {};

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string[]] =>
      Array.isArray(entry[1]) &&
      entry[1].every((item) => typeof item === "string"),
  );
  return Object.fromEntries(entries);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
