const NATIONAL = /^(?:\+86)?(1[3-9]\d{9})$/;

export function maskPhone(phone: string): string {
  const match = phone.trim().replace(/[\s-]/g, "").match(NATIONAL);
  if (!match) return phone;
  const national = match[1];
  return `${national.slice(0, 3)}****${national.slice(7)}`;
}
