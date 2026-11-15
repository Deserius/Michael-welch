import { defineConfig, loadEnv } from 'vite';

const API_PORT = process.env.API_PORT || 8787;

/**
 * The frontend is the prebuilt RoastBox bundle served from `public/`
 * (`app.js` + `styles.css`), so this config only needs to serve static assets
 * and proxy `/api` to the function runtime.
 *
 * The legacy React source under `src/` is kept for reference but is no longer
 * referenced by index.html, so it is not built.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'NEXT_PUBLIC_']);

  // Only VITE_/NEXT_PUBLIC_ values are inlined by design — service-role and
  // provider keys must never reach the browser.
  const defines: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    defines[`process.env.${key}`] = JSON.stringify(value);
  }

  return {
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: defines,
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      // The preview runs behind a proxied host; allow it through.
      allowedHosts: true,
      // `npm run dev` starts scripts/dev-api.mjs alongside vite. Proxying keeps
      // every request same-origin, exactly like the Vercel deployment.
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${API_PORT}`,
          changeOrigin: false,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
    },
  };
});
