import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_PORT = process.env.API_PORT || 8787;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['VITE_', 'NEXT_PUBLIC_']);

  // Only VITE_/NEXT_PUBLIC_ values are inlined into the bundle by design —
  // service-role and provider keys must never reach the browser.
  const defines: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    defines[`process.env.${key}`] = JSON.stringify(value);
  }

  return {
    plugins: [react(), tailwindcss()],
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
    build: {
      rollupOptions: {
        output: {
          // Split the heavy vendor libs out of the app chunk (was a single
          // 636 kB bundle, over Rollup's warning threshold).
          manualChunks: {
            react: ['react', 'react-dom', 'react-router-dom'],
            supabase: ['@supabase/supabase-js'],
            motion: ['framer-motion'],
          },
        },
      },
    },
  };
});
