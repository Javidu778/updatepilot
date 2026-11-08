/**
 * Escapes the characters that have a special meaning in a SQL LIKE pattern (% _ and the escape
 * character itself), so a search for "100%" finds "100%" and a search for "_" finds "_".
 * Prisma's `contains` passes the text on as a pattern and does not do this.
 * PostgreSQL uses a backslash as the default LIKE escape character.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}
