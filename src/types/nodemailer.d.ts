/**
 * Minimal ambient types for `nodemailer`.
 *
 * The package ships no types and `@types/nodemailer` would be a devDependency
 * carrying the whole API surface for the two calls this application makes.
 * Both call sites — the Proton bridge's SMTP send and the digest channel —
 * already work through their own narrow interfaces, so the only thing needed
 * here is enough to type `createTransport`'s return as unknown-and-castable
 * rather than implicit `any`.
 *
 * Deliberately not a full definition. A partial one that lies would be worse
 * than none; this one only claims the function exists.
 */
declare module "nodemailer" {
  export function createTransport(options: unknown): unknown;
  const nodemailer: { createTransport: typeof createTransport };
  export default nodemailer;
}
