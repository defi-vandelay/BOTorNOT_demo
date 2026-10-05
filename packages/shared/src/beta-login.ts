/**
 * The text a beta username and password are hashed from. The username ignores case and
 * surrounding spaces, since phones capitalise the first letter; the password is exact.
 */
export function betaLoginText(username: string, password: string): string {
  return `botornot-beta\n${username.trim().toLowerCase()}\n${password}`;
}

/**
 * SHA-256 of betaLoginText as hex: what hello.login carries, so the browser keeps this rather
 * than the password itself. Needs a secure page (https or localhost).
 */
export async function betaLoginKey(username: string, password: string): Promise<string> {
  const bytes = new TextEncoder().encode(betaLoginText(username, password));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}
