import { defineConfig } from 'vite';

export default defineConfig({
  // base must match the GitHub Pages subpath.
  // CommunityHub repo is served at the root of its Pages site,
  // so we use '/' here. Adjust if the repo has a subfolder base.
  base: '/',

  build: {
    outDir:    'dist',
    emptyOutDir: true,
    // Inline assets under 4KB to reduce round trips
    assetsInlineLimit: 4096,
  },

  server: {
    port: 5173,
    // Proxy API calls during local dev so no CORS issues
    proxy: {
      '/api': {
        target: 'https://api.venuedesk.co.uk',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
