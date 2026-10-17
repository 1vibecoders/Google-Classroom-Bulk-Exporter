export { sync as POST } from '../server/routes.js';
// A run still marked running after this is treated as dead (server/sync.ts RUNNING_MINUTES).
export const maxDuration = 300;
