import { describe, expect, it } from 'vitest';
import { TableSaveStore } from '../src/saves';

/**
 * Azure Table Storage adapter, tested against the Azurite emulator when available:
 *   npx azurite --tableHost 127.0.0.1  and  AZURITE=1 npx vitest run apps/server
 */
const AZURITE_CONN =
  'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;TableEndpoint=http://127.0.0.1:10002/devstoreaccount1;';

describe.skipIf(!process.env.AZURITE)('TableSaveStore (Azurite)', () => {
  it('stores large saves in chunks and reads them back', async () => {
    const store = await TableSaveStore.create(AZURITE_CONN, `saves${Date.now()}`);
    const data = JSON.stringify({ blob: 'x'.repeat(100_000) });
    await store.put({ code: 'ABC234', owner: 'o'.repeat(32), updated: 1000, data });
    const got = await store.get('ABC234');
    expect(got?.data).toBe(data);
    expect(got?.owner).toBe('o'.repeat(32));
    expect(await store.get('ZZZZZZ')).toBeNull();
    expect(await store.purgeExpired(1000 + 8 * 24 * 3600 * 1000)).toBe(1);
    expect(await store.get('ABC234')).toBeNull();
  });
});
