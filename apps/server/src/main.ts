import { fileURLToPath } from 'node:url';
import { createApp, lanAddresses } from './app';
import { createSaveStore } from './saves';
import { Telemetry } from './telemetry';

const port = Number(process.env.PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? fileURLToPath(new URL('../../../.data', import.meta.url));
const staticDir = process.env.STATIC_DIR ?? fileURLToPath(new URL('../../web/dist', import.meta.url));

const saves = await createSaveStore(process.env, dataDir);
const telemetry = new Telemetry(dataDir, process.env.APPLICATIONINSIGHTS_CONNECTION_STRING);
const app = createApp({ saves, telemetry, staticDir });

app.server.listen(port, '0.0.0.0', () => {
  console.log(`Würfel-Bande Server auf Port ${port} (Saves: ${saves.kind})`);
  console.log(`  lokal:  http://localhost:${port}/host`);
  for (const ip of lanAddresses()) console.log(`  WLAN:   http://${ip}:${port}/host`);
});

const shutdown = () => app.close().then(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
