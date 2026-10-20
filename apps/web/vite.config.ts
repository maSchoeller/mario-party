import { resolve } from 'node:path';
import { defineConfig, type PluginOption } from 'vite';

const serverTarget = process.env.WB_SERVER ?? 'http://localhost:8787';

export default defineConfig(async () => {
  const plugins: PluginOption[] = [];
  if (process.env.HTTPS === '1') {
    // Gyro (iOS), Wake Lock and others need a secure context on phones in the LAN.
    const ssl = (await import('@vitejs/plugin-basic-ssl')).default;
    plugins.push(ssl() as unknown as PluginOption);
  }
  return {
    plugins,
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/ws': { target: serverTarget.replace(/^http/, 'ws'), ws: true },
        '/api': { target: serverTarget },
      },
    },
    preview: { host: true, port: 4173 },
    optimizeDeps: { exclude: ['@babylonjs/havok'] },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 6000,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          host: resolve(__dirname, 'host.html'),
          play: resolve(__dirname, 'play.html'),
          dev: resolve(__dirname, 'dev.html'),
        },
      },
    },
  };
});
