import { importScalarSample } from '@crm/contracts/import-heading';

type Member = {
  displayName: string | null;
  user: { displayName: string; phone: string; email: string | null };
};

export function importMemberPrivacy(members: Member[]) {
  const terms = new Map<number, Set<string>>();
  const phones = new Set<string>();
  const normalize = (s: string) => s.normalize('NFKC').trim().toLowerCase();
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    const term = normalize(raw);
    if (Array.from(term).length < 2) return;
    const group = terms.get(term.length) ?? new Set<string>();
    group.add(term);
    terms.set(term.length, group);
  };
  for (const { displayName, user } of members) {
    add(displayName);
    add(user.displayName);
    add(user.phone);
    add(user.email);
    if (user.email) add(importScalarSample(user.email));
    const digits = user.phone.replace(/\D/g, '');
    if (digits) {
      const local = digits.replace(/^86(?=1\d{10}$)/, '');
      phones.add(local);
      add(importScalarSample(local));
    }
  }
  function matches(raw: string) {
    const text = normalize(raw);
    for (const [size, words] of terms) {
      for (let pos = 0; pos <= text.length - size; pos++) {
        if (words.has(text.slice(pos, pos + size))) return true;
      }
    }
    for (const part of text.match(/[+\d(][\d\s()-]{5,}\d/g) ?? []) {
      if (phones.has(part.replace(/\D/g, '').replace(/^86(?=1\d{10}$)/, '')))
        return true;
    }
    return false;
  }
  let count = 0;
  function redact(raw: string) {
    if (!matches(raw)) return raw;
    count++;
    return '[成员]';
  }
  // Walk strings individually so matches cannot straddle JSON keys or cells.
  function contains(value: unknown): boolean {
    if (typeof value === 'string') {
      if (!matches(value)) return false;
      count++;
      return true;
    }
    if (!value || typeof value !== 'object') return false;
    let found = false;
    for (const item of Object.values(value)) {
      if (contains(item)) found = true;
    }
    return found;
  }
  return {
    redact,
    contains,
    get count() {
      return count;
    },
  };
}
