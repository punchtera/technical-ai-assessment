import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ApiClient } from './api/client';

const ApiContext = createContext<ApiClient | null>(null);

export function ApiProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): ApiClient {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside ApiProvider');
  return api;
}

/**
 * Reviewer handle sent as `X-Actor`. There is no authentication in this
 * version; the handle is chosen by the person using the app and is never
 * invented by the UI. Stored per browser as a convenience only.
 */
const STORAGE_KEY = 'fis.reviewerHandle';
export const HANDLE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

interface ReviewerContextValue {
  handle: string;
  setHandle(handle: string): void;
}

const ReviewerContext = createContext<ReviewerContextValue | null>(null);

function readStoredHandle(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function ReviewerProvider({ children }: { children: ReactNode }) {
  const [handle, setHandleState] = useState(readStoredHandle);
  const setHandle = useCallback((value: string) => {
    setHandleState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // storage unavailable: keep the value for this session only
    }
  }, []);
  const value = useMemo(() => ({ handle, setHandle }), [handle, setHandle]);
  return <ReviewerContext.Provider value={value}>{children}</ReviewerContext.Provider>;
}

export function useReviewer(): ReviewerContextValue & { valid: boolean } {
  const ctx = useContext(ReviewerContext);
  if (!ctx) throw new Error('useReviewer must be used inside ReviewerProvider');
  return { ...ctx, valid: HANDLE_PATTERN.test(ctx.handle) };
}
