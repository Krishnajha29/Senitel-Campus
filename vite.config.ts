import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { presenceApiPlugin } from './src/server/presenceApiMiddleware.ts';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), presenceApiPlugin()],
  envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
});
