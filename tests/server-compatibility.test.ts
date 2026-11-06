import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createStore, type Store } from '../server/store';
import {
  regenerateSnapshot,
  validateLegacySnapshot,
  validateLegacyV2Snapshot,
} from '../shared/domain';
import type { CaseRecord, Draft, LegacySnapshot, LegacyV2Snapshot, Version } from '../shared/types';

let directory: string;
let filename: string;
let store: Store;
let db: DatabaseSync;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'anken-legacy-'));
  filename = join(directory, 'test.sqlite');
  store = createStore(filename);
  db = new DatabaseSync(filename);
});
afterEach(() => {
  db.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
});
function seedLegacy(withDraft = true, format: 'v1' | 'v2' = 'v1') {
  const snapshot =
    format === 'v1'
      ? validateLegacySnapshot(
          JSON.parse(
            readFileSync(new URL('./fixtures/legacy-web-asp.json', import.meta.url), 'utf8'),
          ),
        )
      : validateLegacyV2Snapshot(
          JSON.parse(
            readFileSync(new URL('./fixtures/legacy-v2-mixed.json', import.meta.url), 'utf8'),
          ),
        );
  const now = '2026-11-06T00:00:00.000Z';
  const caseId = randomUUID(),
    versionId = randomUUID(),
    draftId = randomUUID();
  const item: CaseRecord = {
    id: caseId,
    name: '旧形式の案件',
    registration: 'existing',
    headVersionId: versionId,
    createdAt: now,
    updatedAt: now,
  };
  const version: Version = {
    id: versionId,
    caseId,
    number: 1,
    baseVersionId: null,
    snapshot,
    reason: '旧版保存',
    createdAt: now,
    status: 'unresolved',
  };
  const draft: Omit<Draft, 'snapshot'> & { snapshot: LegacySnapshot | LegacyV2Snapshot } = {
    id: draftId,
    caseId,
    baseVersionId: versionId,
    expectedHeadId: versionId,
    revision: 7,
    snapshot,
    reason: '旧形式の下書き',
    updatedAt: now,
  };
  db.prepare('INSERT INTO cases (id, data) VALUES (?, ?)').run(caseId, JSON.stringify(item));
  const versionBytes = JSON.stringify(version);
  const draftBytes = JSON.stringify(draft);
  db.prepare('INSERT INTO versions (id, case_id, number, data) VALUES (?, ?, ?, ?)').run(
    versionId,
    caseId,
    1,
    versionBytes,
  );
  if (withDraft)
    db.prepare('INSERT INTO drafts (id, case_id, data) VALUES (?, ?, ?)').run(
      draftId,
      caseId,
      draftBytes,
    );
  return { item, version, draft, versionBytes, draftBytes };
}
function stored(table: 'versions' | 'drafts', id: string) {
  return (
    db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id) as { data: string } | undefined
  )?.data;
}

describe('メディアライン単位への移行と保存版の互換性', () => {
  it('旧下書きだけを読み込み時に変換し、旧保存版とDB上のJSONを変更しない', () => {
    const legacy = seedLegacy();
    const detail = store.detail(legacy.item.id);
    expect(detail.versions[0]).toEqual(legacy.version);
    expect(detail.draft).toMatchObject({
      revision: 7,
      expectedHeadId: legacy.version.id,
      baseVersionId: legacy.version.id,
    });
    expect(detail.draft!.snapshot.schemaVersion).toBe(3);
    expect(detail.draft!.snapshot.answers).not.toHaveProperty('isDirect');
    expect(detail.draft!.snapshot.mediaLines).toEqual([
      { id: 'default', name: '旧版の手動メディア名', isDirect: false },
    ]);
    expect(
      detail.draft!.snapshot.graph.nodes.find((node) => node.id === 'web-media'),
    ).toMatchObject({
      title: '旧版の手動メディア名',
      url: 'https://example.test/legacy-asp',
      note: '旧版の注記',
      position: { x: 42, y: 83 },
    });
    expect(stored('versions', legacy.version.id)).toBe(legacy.versionBytes);
    expect(stored('drafts', legacy.draft.id)).toBe(legacy.draftBytes);
    store.close();
    store = createStore(filename);
    expect(store.detail(legacy.item.id)).toEqual(detail);
    expect(stored('versions', legacy.version.id)).toBe(legacy.versionBytes);
    expect(stored('drafts', legacy.draft.id)).toBe(legacy.draftBytes);
  });

  it('旧下書きへ個別経路のメディアラインを追加し、新版保存後も旧版のJSONを保持する', () => {
    const legacy = seedLegacy();
    const draft = store.detail(legacy.item.id).draft!;
    const mediaLines = [
      ...draft.snapshot.mediaLines,
      { id: 'second', name: '直メディアライン', isDirect: true },
    ];
    const { snapshot } = regenerateSnapshot(draft.snapshot, draft.snapshot.answers, mediaLines);
    const changed = store.updateDraft(draft.id, {
      revision: draft.revision,
      snapshot,
      reason: 'メディアラインを追加',
    });
    const saved = store.saveVersion(changed.id, changed.revision);
    expect(saved.version.number).toBe(2);
    expect(saved.version.snapshot.schemaVersion).toBe(3);
    expect(saved.draft.snapshot.mediaLines).toEqual(mediaLines);
    expect(saved.draft.snapshot.graph.nodes.some((node) => node.id === 'web-aa')).toBe(true);
    expect(saved.draft.snapshot.graph.nodes.some((node) => node.id === 'web-aa-second')).toBe(
      false,
    );
    expect(saved.draft.snapshot.graph.edges).toContainEqual(
      expect.objectContaining({
        source: 'web-media-second',
        target: 'web-lp',
        identifier: 'affnmsid',
      }),
    );
    expect(stored('versions', legacy.version.id)).toBe(legacy.versionBytes);
    store.close();
    store = createStore(filename);
    expect(store.detail(legacy.item.id).versions).toEqual([saved.version, legacy.version]);
    expect(store.detail(legacy.item.id).draft).toEqual(saved.draft);
    expect(stored('versions', legacy.version.id)).toBe(legacy.versionBytes);
  });

  it('旧版からの編集開始でも入稿経路・配置・注記を維持し、旧版を上書きしない', () => {
    const legacy = seedLegacy(false);
    const draft = store.startDraft(legacy.item.id, {
      baseVersionId: legacy.version.id,
      expectedHeadId: legacy.version.id,
    });
    expect(draft.snapshot.schemaVersion).toBe(3);
    expect(draft.snapshot.mediaLines[0].isDirect).toBe(false);
    expect(draft.snapshot.graph.nodes[0].position).toEqual({ x: 42, y: 83 });
    expect(draft.baseVersionId).toBe(legacy.version.id);
    const changed = store.updateDraft(draft.id, {
      revision: draft.revision,
      snapshot: draft.snapshot,
      reason: '旧版を元に保存',
    });
    const saved = store.saveVersion(changed.id, changed.revision);
    expect(saved.version.number).toBe(2);
    expect(saved.version.baseVersionId).toBe(legacy.version.id);
    expect(stored('versions', legacy.version.id)).toBe(legacy.versionBytes);
    expect(store.detail(legacy.item.id).versions[1]).toEqual(legacy.version);
  });
});

describe('旧V2の分割図から単一グラフへの互換性', () => {
  it('旧V2下書きは編集用コピーだけ変換し、保存版と下書きの元JSONを変更しない', () => {
    const legacy = seedLegacy(true, 'v2');
    const detail = store.detail(legacy.item.id);
    expect(detail.versions[0]).toEqual(legacy.version);
    expect(detail.versions[0].snapshot.schemaVersion).toBe(2);
    expect(detail.draft!.snapshot.schemaVersion).toBe(3);
    expect(detail.draft!.snapshot.graph.id).toBe('main');
    expect(detail.draft!.snapshot).not.toHaveProperty('routes');
    expect(detail.draft!.revision).toBe(7);
    expect(detail.draft!.expectedHeadId).toBe(legacy.version.id);
    expect(detail.draft!.snapshot.mediaLines).toEqual([
      { id: 'default', name: '旧V2直メディアライン', isDirect: true },
      { id: 'asp-line', name: '旧V2ASPライン', isDirect: false },
    ]);
    expect(
      detail.draft!.snapshot.graph.nodes.find((node) => node.id === 'web-media'),
    ).toMatchObject({
      url: 'https://example.test/v2-direct',
      note: 'V2の手動注記',
      position: { x: 58, y: 91 },
    });
    expect(
      detail.draft!.snapshot.graph.nodes.find((node) => node.id === 'phone-placeholder')?.note,
    ).toContain('旧電話導線の検討メモ');
    expect(stored('versions', legacy.version.id)).toBe(legacy.versionBytes);
    expect(stored('drafts', legacy.draft.id)).toBe(legacy.draftBytes);
    expect(() =>
      store.updateDraft(legacy.draft.id, {
        revision: legacy.draft.revision,
        snapshot: legacy.version.snapshot,
        reason: '古い画面からの更新',
      }),
    ).toThrow('導線データが不正');
    expect(stored('drafts', legacy.draft.id)).toBe(legacy.draftBytes);
  });

  it('旧V2から経路を変更して統合版を保存・再起動しても過去の分割図JSONを維持する', () => {
    const legacy = seedLegacy(true, 'v2');
    const draft = store.detail(legacy.item.id).draft!;
    const next = regenerateSnapshot(
      draft.snapshot,
      {
        ...draft.snapshot.answers,
        measurements: ['web', 'app', 'phone', 'line'],
      },
      draft.snapshot.mediaLines.map((line) =>
        line.id === 'default' ? { ...line, isDirect: false } : line,
      ),
    ).snapshot;
    const changed = store.updateDraft(draft.id, {
      revision: draft.revision,
      snapshot: next,
      reason: '計測を一枚の図に統合',
    });
    const saved = store.saveVersion(changed.id, changed.revision);
    expect(saved.version.number).toBe(2);
    expect(saved.version.snapshot.schemaVersion).toBe(3);
    expect(saved.version.snapshot.graph.nodes.some((node) => node.id === 'web-aa')).toBe(true);
    expect(saved.version.snapshot.graph.nodes.some((node) => node.measurement === 'line')).toBe(
      true,
    );
    expect(
      saved.version.snapshot.graph.nodes.find((node) => node.id === 'phone-placeholder')?.note,
    ).toContain('旧電話導線の検討メモ');
    store.close();
    store = createStore(filename);
    expect(store.detail(legacy.item.id).versions).toEqual([saved.version, legacy.version]);
    expect(store.detail(legacy.item.id).draft).toEqual(saved.draft);
    expect(stored('versions', legacy.version.id)).toBe(legacy.versionBytes);
    const restored = store.startDraft(legacy.item.id, {
      baseVersionId: legacy.version.id,
      expectedHeadId: saved.version.id,
      replaceRevision: saved.draft.revision,
    });
    expect(restored.snapshot.schemaVersion).toBe(3);
    expect(restored.snapshot.mediaLines[0].isDirect).toBe(true);
    expect(restored.snapshot.graph.nodes.find((node) => node.id === 'web-media')?.position).toEqual(
      { x: 58, y: 91 },
    );
    expect(stored('versions', legacy.version.id)).toBe(legacy.versionBytes);
  });

  it('旧V2保存版から直接編集を開始しても保存版は書き換えない', () => {
    const legacy = seedLegacy(false, 'v2');
    const draft = store.startDraft(legacy.item.id, {
      baseVersionId: legacy.version.id,
      expectedHeadId: legacy.version.id,
    });
    expect(draft.snapshot.graph.id).toBe('main');
    expect(draft.snapshot.answers.measurements).toEqual(['web', 'app', 'phone']);
    expect(draft.snapshot.graph.nodes.find((node) => node.id === 'web-media')?.note).toBe(
      'V2の手動注記',
    );
    expect(stored('versions', legacy.version.id)).toBe(legacy.versionBytes);
  });
});
