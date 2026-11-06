import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, type Store } from '../server/store';

let directory: string;
let store: Store;
let faultConnection: DatabaseSync;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'anken-transaction-'));
  const filename = join(directory, 'transaction.sqlite');
  store = createStore(filename);
  faultConnection = new DatabaseSync(filename);
});
afterEach(() => {
  faultConnection.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('バージョン保存のトランザクション', () => {
  it.each(['cases', 'drafts'] as const)(
    '%s更新時の障害で、追加済みの版と最新版更新もロールバックする',
    (table) => {
      const before = store.createCase({
        name: '保存途中の障害確認',
        registration: 'new',
        answers: { postback: true, measurements: ['web'] },
      });
      const draft = before.draft!;
      // versionsへのINSERT後に処理されるUPDATEだけを失敗させる。
      // draftsで失敗するケースでは、casesの最新版ID更新も実行済みとなる。
      faultConnection.exec(`
      CREATE TRIGGER fail_version_save
      BEFORE UPDATE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, 'forced-save-failure');
      END;
    `);

      expect(() => store.saveVersion(draft.id, draft.revision)).toThrow('forced-save-failure');
      expect(store.detail(before.case.id)).toEqual(before);
      expect(faultConnection.prepare('SELECT COUNT(*) AS count FROM versions').get()).toMatchObject(
        { count: 0 },
      );

      // 同じ下書き改訂のまま再試行でき、失敗した版が連番を消費していない。
      faultConnection.exec('DROP TRIGGER fail_version_save');
      const saved = store.saveVersion(draft.id, draft.revision);
      expect(saved.version.number).toBe(1);
      expect(saved.version.snapshot).toEqual(draft.snapshot);
      expect(store.detail(before.case.id).case.headVersionId).toBe(saved.version.id);
      expect(store.detail(before.case.id).versions).toEqual([saved.version]);
      expect(store.detail(before.case.id).draft?.revision).toBe(draft.revision + 1);
    },
  );
});
