// Vitest runs on Vite, whose `import.meta.glob` is not in our direct dependencies' typings.
// Declare the one overload the tests use.
interface ImportMeta {
  glob<T = unknown>(pattern: string, options: { eager: true }): Record<string, T>;
}
