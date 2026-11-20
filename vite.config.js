// Vite compiles JSX with its built-in esbuild, so no React plugin is needed.
export default {
  root: 'web',
  esbuild: { jsx: 'automatic' },
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8787' },
    fs: { allow: ['..'] }, // lets the web app import ../shared/protocol.js
  },
};
