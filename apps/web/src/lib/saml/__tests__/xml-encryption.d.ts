// Minimal typing for the test-only fake IdP (the package ships none we can resolve here).
declare module 'xml-encryption' {
  export function encrypt(
    content: string,
    options: Record<string, unknown>,
    cb: (err: Error | null, result: string) => void,
  ): void;
}
