import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      { 
        entry: 'src/main/index.ts',
        vite: {
          build: {
            external: ['ws', 'bufferutil', 'utf-8-validate'],
          }
        }
      },
      { entry: 'src/main/preload.ts', onstart(args) { args.reload(); } },
    ]),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  build: {
    outDir: 'dist/renderer',
  },
});
