import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { ApiClientError } from '../api/client';

export type Resource<T> =
  | { status: 'loading'; data?: undefined; error?: undefined }
  | { status: 'error'; data?: T; error: ApiClientError }
  | { status: 'ready'; data: T; error?: undefined };

interface Stored<T> {
  key: string | null;
  data?: T;
  error?: ApiClientError;
}

const toApiError = (error: unknown) =>
  error instanceof ApiClientError ? error : new ApiClientError('Unexpected error', 0);

/**
 * Loads data with explicit loading / error / ready states, supports manual
 * reload, and optionally polls while `pollMs(data)` returns a number.
 * `deps` must be primitives; they identify what is being loaded.
 */
export function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly (string | number | boolean | null | undefined)[],
  pollMs?: (data: T) => number | null,
): Resource<T> & { reload: () => Promise<void> } {
  const key = JSON.stringify(deps);
  const [stored, setStored] = useState<Stored<T>>({ key: null });

  const fetchInto = useEffectEvent(async (signal: AbortSignal) => {
    try {
      const data = await load(signal);
      if (!signal.aborted) setStored({ key, data });
    } catch (error) {
      if (signal.aborted || (error as Error)?.name === 'AbortError') return;
      setStored((prev) => ({
        key,
        data: prev.key === key ? prev.data : undefined,
        error: toApiError(error),
      }));
    }
  });
  const nextPoll = useEffectEvent((data: T) => (pollMs ? pollMs(data) : null));

  useEffect(() => {
    const controller = new AbortController();
    void fetchInto(controller.signal);
    return () => controller.abort();
  }, [key]);

  // Polling: re-fetch while the caller says the data is still changing.
  const current = stored.key === key ? stored : null;
  const data = current?.data;
  useEffect(() => {
    if (data === undefined) return;
    const delay = nextPoll(data);
    if (delay === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void fetchInto(controller.signal), delay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [data]);

  const reload = useCallback(async () => {
    try {
      const fresh = await load(new AbortController().signal);
      setStored({ key, data: fresh });
    } catch (error) {
      setStored((prev) => ({ ...prev, key, error: toApiError(error) }));
    }
  }, [load, key]);

  let resource: Resource<T>;
  if (!current) resource = { status: 'loading' };
  else if (current.error) resource = { status: 'error', error: current.error, data: current.data };
  else resource = { status: 'ready', data: current.data as T };
  return { ...resource, reload };
}
