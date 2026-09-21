/**
 * Minimal ambient declarations for Node builtins used ONLY in vitest test
 * files (the app source targets the browser and the project intentionally
 * omits @types/node — see tsconfig "types").
 */
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare const process: {
  cwd(): string;
  env: Record<string, string | undefined>;
};
