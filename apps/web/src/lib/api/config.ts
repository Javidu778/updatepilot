/** Public, non-secret setting. Inlined into the browser bundle when the app is built. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
