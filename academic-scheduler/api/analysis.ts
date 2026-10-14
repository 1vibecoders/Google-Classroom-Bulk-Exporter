export { getAnalysis as GET, postAnalysis as POST } from '../server/aiRoutes.js';

// A planning run may read a big import for up to RUN_SECONDS (server/analysis.ts) before it answers.
export const maxDuration = 300;
