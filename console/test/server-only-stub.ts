// Stub for the `server-only` package under vitest (RQ-0008). The real package throws on import outside
// a React Server Component bundle; aliasing to this empty module lets the server-side modules be
// imported and unit-tested. See vitest.config.ts.
export {};
