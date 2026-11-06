import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateSnapshot, getIssues, normalizeSnapshot, validateSnapshot } from '../shared/domain';
import type {
  Answers,
  CaseDetail,
  CaseRecord,
  CaseSummary,
  Draft,
  Snapshot,
  Version,
} from '../shared/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function checkedSnapshot(value: unknown): Snapshot {
  try {
    return validateSnapshot(value);
  } catch {
    throw new ApiError(400, '導線データが不正です。接続先・回答・項目を確認してください。');
  }
}
function revisionMatches(actual: number, expected: number) {
  if (actual !== expected)
    throw new ApiError(409, '別の操作で下書きが更新されました。内容を再読み込みしてください。');
}
function parseData<T>(row: unknown): T | null {
  if (!row) return null;
  return JSON.parse((row as { data: string }).data) as T;
}

export function createStore(filename = ':memory:') {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
  const schemaVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number })
    .user_version;
  if (schemaVersion > 1) {
    db.close();
    throw new Error('このアプリでは開けない新しいデータ形式です。');
  }
  if (schemaVersion === 0) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE cases (id TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
      CREATE TABLE versions (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL REFERENCES cases(id),
        number INTEGER NOT NULL CHECK(number > 0),
        data TEXT NOT NULL CHECK(json_valid(data)),
        UNIQUE(case_id, number)
      );
      CREATE TABLE drafts (
        id TEXT PRIMARY KEY,
        case_id TEXT NOT NULL UNIQUE REFERENCES cases(id),
        data TEXT NOT NULL CHECK(json_valid(data))
      );
      PRAGMA user_version = 1;
      COMMIT;`);
  }

  function atomic<T>(operation: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  function getCase(id: string): CaseRecord {
    const item = parseData<CaseRecord>(db.prepare('SELECT data FROM cases WHERE id = ?').get(id));
    if (!item) throw new ApiError(404, '案件が見つかりません。');
    return item;
  }
  function getDraft(id: string): Draft {
    const item = parseData<Draft>(db.prepare('SELECT data FROM drafts WHERE id = ?').get(id));
    if (!item) throw new ApiError(404, '下書きが見つかりません。');
    return { ...item, snapshot: normalizeSnapshot(item.snapshot) };
  }
  function draftForCase(id: string): Draft | null {
    const draft = parseData<Draft>(db.prepare('SELECT data FROM drafts WHERE case_id = ?').get(id));
    return draft ? { ...draft, snapshot: normalizeSnapshot(draft.snapshot) } : null;
  }
  function getVersion(id: string, caseId: string): Version {
    const item = parseData<Version>(
      db.prepare('SELECT data FROM versions WHERE id = ? AND case_id = ?').get(id, caseId),
    );
    if (!item) throw new ApiError(404, 'この案件のバージョンが見つかりません。');
    return item;
  }
  function detail(id: string): CaseDetail {
    return {
      case: getCase(id),
      draft: draftForCase(id),
      versions: db
        .prepare('SELECT data FROM versions WHERE case_id = ? ORDER BY number DESC')
        .all(id)
        .map((row) => parseData<Version>(row)!),
    };
  }
  function putDraft(draft: Draft) {
    db.prepare(
      'INSERT INTO drafts (id, case_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
    ).run(draft.id, draft.caseId, JSON.stringify(draft));
  }
  function putCase(item: CaseRecord) {
    db.prepare('UPDATE cases SET data = ? WHERE id = ?').run(JSON.stringify(item), item.id);
  }
  function headMatches(item: CaseRecord, expectedHeadId: string | null) {
    if (item.headVersionId !== expectedHeadId)
      throw new ApiError(
        409,
        '別の操作で新しいバージョンが保存されました。最新の内容を確認してください。',
      );
  }

  return {
    close() {
      db.close();
    },
    listCases(): CaseSummary[] {
      return db
        .prepare(
          `SELECT c.data, (SELECT COUNT(*) FROM versions v WHERE v.case_id = c.id) AS version_count,
        EXISTS(SELECT 1 FROM drafts d WHERE d.case_id = c.id) AS has_draft FROM cases c`,
        )
        .all()
        .map((row) => {
          const item = row as { data: string; version_count: number; has_draft: number };
          return {
            ...(JSON.parse(item.data) as CaseRecord),
            versionCount: item.version_count,
            hasDraft: !!item.has_draft,
          };
        })
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    detail,
    createCase(input: {
      name: string;
      registration: 'new' | 'existing';
      answers: Answers;
    }): CaseDetail {
      const name = input.name.trim();
      if (!name || name.length > 200)
        throw new ApiError(400, '案件名を1〜200文字で入力してください。');
      const snapshot = checkedSnapshot(generateSnapshot(input.answers));
      return atomic(() => {
        const now = new Date().toISOString();
        const item: CaseRecord = {
          id: randomUUID(),
          name,
          registration: input.registration,
          headVersionId: null,
          createdAt: now,
          updatedAt: now,
        };
        db.prepare('INSERT INTO cases (id, data) VALUES (?, ?)').run(item.id, JSON.stringify(item));
        putDraft({
          id: randomUUID(),
          caseId: item.id,
          baseVersionId: null,
          expectedHeadId: null,
          revision: 1,
          snapshot,
          reason: '初回作成',
          updatedAt: now,
        });
        return detail(item.id);
      });
    },
    startDraft(
      caseId: string,
      input: {
        baseVersionId: string | null;
        expectedHeadId: string | null;
        replaceRevision?: number;
      },
    ): Draft {
      return atomic(() => {
        const item = getCase(caseId);
        headMatches(item, input.expectedHeadId);
        const previous = draftForCase(caseId);
        const baseId = input.baseVersionId ?? item.headVersionId;
        if (!baseId) {
          if (previous) return previous;
          throw new ApiError(400, '編集元のバージョンがありません。');
        }
        const version = getVersion(baseId, caseId);
        if (previous && input.replaceRevision === undefined)
          throw new ApiError(409, '既存の下書きがあります。置き換える内容を確認してください。');
        if (previous) revisionMatches(previous.revision, input.replaceRevision!);
        else if (input.replaceRevision !== undefined)
          throw new ApiError(409, '下書きの状態が変わりました。再読み込みしてください。');
        const now = new Date().toISOString();
        const draft: Draft = {
          id: previous?.id ?? randomUUID(),
          caseId,
          baseVersionId: version.id,
          expectedHeadId: item.headVersionId,
          revision: (previous?.revision ?? 0) + 1,
          snapshot: normalizeSnapshot(version.snapshot),
          reason: '',
          updatedAt: now,
        };
        putDraft(draft);
        putCase({ ...item, updatedAt: now });
        return draft;
      });
    },
    updateDraft(id: string, input: { revision: number; snapshot: unknown; reason: string }): Draft {
      const snapshot = checkedSnapshot(input.snapshot);
      if (input.reason.length > 2000)
        throw new ApiError(400, '変更理由は2000文字以内で入力してください。');
      return atomic(() => {
        const previous = getDraft(id);
        revisionMatches(previous.revision, input.revision);
        const item = getCase(previous.caseId);
        headMatches(item, previous.expectedHeadId);
        const now = new Date().toISOString();
        const draft: Draft = {
          ...previous,
          revision: previous.revision + 1,
          snapshot,
          reason: input.reason,
          updatedAt: now,
        };
        putDraft(draft);
        putCase({ ...item, updatedAt: now });
        return draft;
      });
    },
    saveVersion(
      id: string,
      expectedRevision: number,
    ): { version: Version & { snapshot: Snapshot }; draft: Draft } {
      return atomic(() => {
        const previous = getDraft(id);
        revisionMatches(previous.revision, expectedRevision);
        const item = getCase(previous.caseId);
        headMatches(item, previous.expectedHeadId);
        if (!previous.reason.trim())
          throw new ApiError(400, 'バージョンを保存する変更理由を入力してください。');
        const snapshot = checkedSnapshot(previous.snapshot);
        const now = new Date().toISOString();
        const max = db
          .prepare('SELECT COALESCE(MAX(number), 0) AS max_number FROM versions WHERE case_id = ?')
          .get(item.id) as { max_number: number };
        const version: Version & { snapshot: Snapshot } = {
          id: randomUUID(),
          caseId: item.id,
          number: max.max_number + 1,
          baseVersionId: previous.baseVersionId,
          snapshot,
          reason: previous.reason.trim(),
          createdAt: now,
          status:
            snapshot.graph.status === 'unresolved' || getIssues(snapshot).length > 0
              ? 'unresolved'
              : 'defined',
        };
        db.prepare('INSERT INTO versions (id, case_id, number, data) VALUES (?, ?, ?, ?)').run(
          version.id,
          item.id,
          version.number,
          JSON.stringify(version),
        );
        putCase({ ...item, headVersionId: version.id, updatedAt: now });
        const draft: Draft = {
          ...previous,
          baseVersionId: version.id,
          expectedHeadId: version.id,
          revision: previous.revision + 1,
          snapshot: structuredClone(snapshot),
          reason: '',
          updatedAt: now,
        };
        putDraft(draft);
        return { version, draft };
      });
    },
  };
}
export type Store = ReturnType<typeof createStore>;
