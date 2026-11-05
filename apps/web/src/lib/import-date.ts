// Two-digit years are explicitly interpreted as 2000–2099.
export function parseImportDate(value: string): string | null {
  const match = /^(\d{4}|\d{2})([./-])(\d{1,2})\2(\d{1,2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]) + (match[1].length === 2 ? 2000 : 0);
  const month = Number(match[3]);
  const day = Number(match[4]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    year < 1000 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${year}-${match[3].padStart(2, "0")}-${match[4].padStart(2, "0")}`;
}
