// Hash routing (works on any static host and from a single offline file):
//   #/day/2026-10-13  #/week/2026-10-12  #/assignments  #/classes
//   #/commitments     #/import           #/settings
// Unknown or malformed hashes fall back to today's day view.
import { useEffect, useState } from 'react';
import { isValidDate, todayLocal } from './lib/time';

export type Route =
  | { name: 'day'; date: string }
  | { name: 'week'; date: string }
  | { name: 'assignments'; classId?: string }
  | { name: 'classes' }
  | { name: 'commitments' }
  | { name: 'import' }
  | { name: 'settings' };

export function parseHash(hash: string, today = todayLocal()): Route {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  const [name, arg] = parts;
  switch (name) {
    case 'day':
    case 'week':
      return { name, date: arg && isValidDate(arg) ? arg : today };
    case 'assignments':
      return arg ? { name, classId: arg } : { name };
    case 'classes':
    case 'commitments':
    case 'import':
    case 'settings':
      return { name };
    default:
      return { name: 'day', date: today };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'day':
    case 'week':
      return `#/${route.name}/${route.date}`;
    case 'assignments':
      return route.classId ? `#/assignments/${encodeURIComponent(route.classId)}` : '#/assignments';
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route): void {
  const hash = routeToHash(route);
  if (window.location.hash !== hash) window.location.hash = hash;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
