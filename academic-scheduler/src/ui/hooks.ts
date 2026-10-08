import { useEffect, useState } from 'react';
import { nowLocal, todayLocal } from '../lib/time';

/** Current local date-time (YYYY-MM-DDTHH:MM:SS), refreshed every 30 seconds. */
export function useNow(): string {
  const [now, setNow] = useState(() => nowLocal());
  useEffect(() => {
    const timer = setInterval(() => setNow(nowLocal()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Today's local date, refreshed with useNow. */
export function useToday(): string {
  const now = useNow();
  return now.slice(0, 10) || todayLocal();
}
