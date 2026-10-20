import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Save game storage (SAVE-01/02). Saves are kept 7 days. Production uses Azure Table
 * Storage; locally a JSON file store (or memory in tests) implements the same interface.
 */
export interface SaveRecord {
  code: string;
  /** host secret – only the creator may overwrite a save */
  owner: string;
  updated: number;
  data: string;
}

export interface SaveStore {
  get(code: string): Promise<SaveRecord | null>;
  put(rec: SaveRecord): Promise<void>;
  purgeExpired(now: number): Promise<number>;
  readonly kind: string;
}

export const SAVE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_SAVE_BYTES = 512 * 1024;

export class MemorySaveStore implements SaveStore {
  readonly kind = 'memory';
  private map = new Map<string, SaveRecord>();
  async get(code: string) {
    return this.map.get(code) ?? null;
  }
  async put(rec: SaveRecord) {
    this.map.set(rec.code, rec);
  }
  async purgeExpired(now: number) {
    let n = 0;
    for (const [k, v] of this.map) if (now - v.updated > SAVE_TTL_MS) (this.map.delete(k), n++);
    return n;
  }
}

export class FileSaveStore implements SaveStore {
  readonly kind = 'file';
  constructor(private readonly dir: string) {}
  private path(code: string) {
    return join(this.dir, `${code.replace(/[^A-Z0-9]/g, '')}.json`);
  }
  async get(code: string) {
    try {
      return JSON.parse(await readFile(this.path(code), 'utf8')) as SaveRecord;
    } catch {
      return null;
    }
  }
  async put(rec: SaveRecord) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(this.path(rec.code), JSON.stringify(rec));
  }
  async purgeExpired(now: number) {
    let n = 0;
    let files: string[] = [];
    try {
      files = await readdir(this.dir);
    } catch {
      return 0;
    }
    for (const f of files) {
      const p = join(this.dir, f);
      const st = await stat(p);
      if (now - st.mtimeMs > SAVE_TTL_MS) (await rm(p), n++);
    }
    return n;
  }
}

/**
 * Azure Table Storage store. Table properties are limited to 64 KiB, so the JSON is
 * split into chunks. Requires AZURE_STORAGE_CONNECTION_STRING (works with Azurite).
 */
export class TableSaveStore implements SaveStore {
  readonly kind = 'azure-table';
  private static CHUNK = 30000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private constructor(private client: any) {}

  static async create(connectionString: string, table = 'saves'): Promise<TableSaveStore> {
    const mod = await import('@azure/data-tables');
    const client = mod.TableClient.fromConnectionString(connectionString, table, { allowInsecureConnection: connectionString.includes('127.0.0.1') || connectionString.includes('localhost') });
    try {
      await client.createTable();
    } catch {
      /* exists */
    }
    return new TableSaveStore(client);
  }

  async get(code: string): Promise<SaveRecord | null> {
    try {
      const e = await this.client.getEntity('save', code);
      const chunks: string[] = [];
      for (let i = 0; i < e.chunks; i++) chunks.push(e[`d${i}`]);
      return { code, owner: e.owner, updated: Number(e.updatedMs), data: chunks.join('') };
    } catch {
      return null;
    }
  }

  async put(rec: SaveRecord): Promise<void> {
    const entity: Record<string, unknown> = { partitionKey: 'save', rowKey: rec.code, owner: rec.owner, updatedMs: String(rec.updated) };
    const n = Math.ceil(rec.data.length / TableSaveStore.CHUNK);
    entity.chunks = n;
    for (let i = 0; i < n; i++) entity[`d${i}`] = rec.data.slice(i * TableSaveStore.CHUNK, (i + 1) * TableSaveStore.CHUNK);
    await this.client.upsertEntity(entity, 'Replace');
  }

  async purgeExpired(now: number): Promise<number> {
    let n = 0;
    for await (const e of this.client.listEntities({ queryOptions: { select: ['rowKey', 'updatedMs'] } })) {
      if (now - Number(e.updatedMs) > SAVE_TTL_MS) {
        await this.client.deleteEntity('save', e.rowKey);
        n++;
      }
    }
    return n;
  }
}

export async function createSaveStore(env: NodeJS.ProcessEnv, dataDir: string): Promise<SaveStore> {
  if (env.AZURE_STORAGE_CONNECTION_STRING) return TableSaveStore.create(env.AZURE_STORAGE_CONNECTION_STRING, env.SAVE_TABLE ?? 'saves');
  if (env.SAVE_STORE === 'memory') return new MemorySaveStore();
  return new FileSaveStore(join(dataDir, 'saves'));
}
