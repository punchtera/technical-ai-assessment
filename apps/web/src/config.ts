/** Browser configuration comes only from VITE_* variables, which must never contain secrets. */
export const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
} as const;
