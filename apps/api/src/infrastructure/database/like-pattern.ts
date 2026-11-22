// PostgreSQL LIKE and Prisma's substring filters both interpret these characters.
export function escapeLikeText(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}
