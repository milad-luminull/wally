import { useEffect, useState } from 'react';
import { localDate } from '@/lib/localDate';

/** Milliseconds from `now` to the next local midnight. */
function untilMidnight(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime() - now.getTime();
}

/**
 * Today in the browser's calendar, read once per render and renewed just after each local
 * midnight, so what depends on the date (Tidy's count) follows it without a reload.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localDate());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // A second past midnight, so the clock has turned when it fires.
      timer = setTimeout(() => {
        setToday(localDate());
        schedule();
      }, untilMidnight() + 1000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, []);
  return today;
}
