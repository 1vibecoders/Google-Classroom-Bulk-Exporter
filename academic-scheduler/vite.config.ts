import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The production page may not contact any server: connect-src 'none' makes
// it impossible for the app to send data anywhere (no analytics, no AI, no
// API). Added only to builds because the dev server needs a websocket.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'academic-scheduler-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// Relative asset paths so the build works on GitHub Pages (any sub-path),
// any static host, and as a single offline file (see scripts/build-single-file.mjs).
export default defineConfig({
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    assetsInlineLimit: 100000,
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
