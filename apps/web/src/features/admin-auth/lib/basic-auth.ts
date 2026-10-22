const encoder = new TextEncoder();

/** RFC 7617: the user-id must not contain ":", it separates it from the password. */
export const isBasicUser = (user: string) => !user.includes(":");

/**
 * `Authorization` header value for HTTP Basic auth. Credentials are UTF-8 encoded
 * (btoa alone throws on "příliš" and mangles "café"); the server decodes them as UTF-8 too.
 */
export function encodeBasicAuth(user: string, password: string): string {
  if (!isBasicUser(user)) throw new RangeError('A Basic auth username cannot contain ":"');
  const bytes = encoder.encode(`${user}:${password}`);
  return `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
}
