// Stand-in for the `server-only` package under test.
//
// The real package has no runtime; it exists so that importing a server
// module from a client component fails the build. Vitest has no such notion,
// so it needs something to resolve to. Deliberately empty.
export {};
