import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      // The legal pages are plain HTML entries, not app routes: they must carry their full
      // text in the served HTML so crawlers that run no JavaScript (Google's OAuth branding
      // review among them) can read them. Cloudflare and nginx serve /privacy from
      // privacy.html, and so does the dev server.
      input: {
        // `index` keeps the bundle's name (assets/index-*.js), which release.yml's smoke test finds.
        index: path.resolve(__dirname, 'index.html'),
        privacy: path.resolve(__dirname, 'privacy.html'),
        terms: path.resolve(__dirname, 'terms.html'),
      },
    },
  },
});
