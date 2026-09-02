import { useEffect, useState } from 'react';

/**
 * `value`, held back until it has stopped changing for `delay` ms.
 *
 * For inputs whose value drives a *read* rather than only a local filter: the
 * team roster's search is matched server-side, so without this every keystroke
 * would be its own request (and its own cache entry) while the coach is still
 * typing the name.
 */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
