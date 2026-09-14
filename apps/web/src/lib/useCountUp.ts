'use client';

import { useEffect, useRef, useState } from 'react';

const EASE_OUT_CUBIC = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Animates from 0 up to `target` once `target` stops being null, easing
 * out (starts fast, settles into the final value — never linear, which
 * reads as a mechanical ticker rather than a value arriving). Returns
 * `null` for as long as `target` is `null`, so callers render their own
 * loading placeholder (e.g. "—") until there's a real value to animate
 * toward — this hook never invents a number.
 */
export function useCountUp(target: number | null, durationMs: number): number | null {
  const [value, setValue] = useState<number | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (target === null) {
      setValue(null);
      return;
    }

    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / durationMs);
      setValue(Math.round((target as number) * EASE_OUT_CUBIC(progress)));
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [target, durationMs]);

  return value;
}
