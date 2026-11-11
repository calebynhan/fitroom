// The ChatGPT panel (src/widget): one classic script, dist/widget/fitroom-tryon.js, loaded by the MCP server's UI
// resource from this site (a classic script needs no CORS; @gradio/client is inlined). Built after the app, into the
// same dist. Same @api alias and VITE_TRYON_SPACE as the app.
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const API_DIR = fileURLToPath(new URL('../api/_lib', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@api': API_DIR } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist/widget',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: { entry: 'src/widget/main.tsx', name: 'FitRoomTryOn', formats: ['iife'], fileName: () => 'fitroom-tryon.js' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
