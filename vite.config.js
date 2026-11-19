import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiMiddleware } from './scripts/local-api.mjs';

// `npm run dev` lance le site ET l'API (/api) en local, sans Vercel.
function localApi() {
  return {
    name: 'eman-local-api',
    configureServer(server) {
      server.middlewares.use(createApiMiddleware((file) => server.ssrLoadModule(file)));
    },
    configurePreviewServer(server) {
      // `npm run preview` : l'API charge les mêmes fichiers, sans rechargement à chaud.
      server.middlewares.use(createApiMiddleware((file) => import(new URL('.' + file, import.meta.url).href)));
    },
  };
}

export default defineConfig(({ mode }) => {
  // Les variables sans préfixe VITE_ (DATABASE_URL, RESEND_API_KEY…) restent côté
  // serveur : on les rend visibles à l'API locale uniquement, jamais au navigateur.
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('VITE_') && process.env[key] === undefined) process.env[key] = value;
  }

  return {
    plugins: [react(), localApi()],
    server: { port: 5173, open: true },
  };
});
