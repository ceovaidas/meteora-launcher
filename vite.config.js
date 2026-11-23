import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  base: '/meteora-launcher/',
  plugins: [nodePolyfills({ include: ['buffer', 'process', 'crypto', 'stream', 'util', 'events'], globals: { Buffer: true, process: true } })],
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
