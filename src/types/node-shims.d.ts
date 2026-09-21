/**
 * Minimal node module shims for vitest tests. The project intentionally
 * has no @types/node dependency (no-new-deps constraint); these declare
 * only the surface the tests use. `readFileSync` returns a `Uint8Array`
 * (Buffer is a Uint8Array subclass, so this is honest typing).
 */
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
}
