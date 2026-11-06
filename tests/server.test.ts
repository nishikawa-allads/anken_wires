import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createStore, type Store } from '../server/store';
import { createApp } from '../server/app';
import { regenerateSnapshot, normalizeSnapshot } from '../shared/domain';
import type { CaseDetail, Draft, Snapshot, Version } from '../shared/types';

let store: Store;
let directory: string;
let server: Server | undefined;
const input = {
  name: '計測導線テスト',
  registration: 'new' as const,
  answers: { postback: true, measurements: ['web' as const] },
};
function createCase() {
  return store.createCase(structuredClone(input));
}
function changeDraft(draft: Draft, reason = 'LP変更'): Draft {
  const snapshot = structuredClone(draft.snapshot);
  const node = snapshot.graph.nodes[0];
  node.title = '変更したメディアライン';
  snapshot.mediaLines[0].name = node.title;
  node.url = 'https://example.com/campaign';
  node.note = '確認用の注記';
  node.position = { x: 42, y: 83 };
  node.manual = ['title', 'url', 'note', 'position'];
  return store.updateDraft(draft.id, { revision: draft.revision, snapshot, reason });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'anken-wires-'));
  store = createStore(join(directory, 'test.sqlite'));
});
afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server!.close((error) => (error ? reject(error) : resolve())),
    );
    server = undefined;
  }
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

async function startApi(developmentOrigin?: string) {
  server = createApp(store, { staticDir: join(directory, 'no-dist'), developmentOrigin }).listen(
    0,
    '127.0.0.1',
  );
  await new Promise<void>((resolve) => server!.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function request(
  base: string,
  path: string,
  method = 'GET',
  body?: unknown,
  extraHeaders?: Record<string, string>,
) {
  return fetch(`${base}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('SQLiteによる導線の保存', () => {
  it('案件・下書き・過去版を再起動後も読み込める', () => {
    const detail = createCase();
    const draft = changeDraft(detail.draft!);
    const { version } = store.saveVersion(draft.id, draft.revision);
    store.close();
    store = createStore(join(directory, 'test.sqlite'));
    const restored = store.detail(detail.case.id);
    expect(restored.case.name).toBe(input.name);
    expect(restored.versions).toEqual([version]);
    expect(restored.draft?.snapshot).toEqual(draft.snapshot);
    expect(store.listCases()[0]).toMatchObject({
      versionCount: 1,
      hasDraft: true,
      headVersionId: version.id,
    });
  });

  it('後続版・下書きの変更から保存済みスナップショットを保護する', () => {
    const detail = createCase();
    const first = store.saveVersion(detail.draft!.id, detail.draft!.revision);
    const original = JSON.stringify(first.version);
    const changed = changeDraft(first.draft);
    const second = store.saveVersion(changed.id, changed.revision);
    second.version.snapshot.graph.nodes[0].title = '呼び出し元による変更';
    const versions = store.detail(detail.case.id).versions;
    expect(versions.map((version) => version.number)).toEqual([2, 1]);
    expect(JSON.stringify(versions[1])).toBe(original);
    expect(normalizeSnapshot(versions[0].snapshot).graph.nodes[0].title).toBe(
      '変更したメディアライン',
    );
    expect(versions[0].baseVersionId).toBe(first.version.id);
    expect(normalizeSnapshot(versions[0].snapshot).graph.nodes[0].position).toEqual({
      x: 42,
      y: 83,
    });
  });

  it('複数メディアラインの入稿経路を独立して変更・保存できる', () => {
    const detail = createCase();
    const initial = detail.draft!;
    const lines = [
      { id: 'default', name: '直メディアライン', isDirect: true },
      { id: 'asp-line', name: 'ASPメディアライン', isDirect: false },
    ];
    const firstSnapshot = regenerateSnapshot(
      initial.snapshot,
      initial.snapshot.answers,
      lines,
    ).snapshot;
    const firstDraft = store.updateDraft(initial.id, {
      revision: initial.revision,
      snapshot: firstSnapshot,
      reason: '異なる入稿経路を登録',
    });
    const first = store.saveVersion(firstDraft.id, firstDraft.revision);
    const changedLines = lines.map((line) =>
      line.id === 'default' ? { ...line, isDirect: false } : line,
    );
    const nextSnapshot = regenerateSnapshot(
      first.draft.snapshot,
      first.draft.snapshot.answers,
      changedLines,
    ).snapshot;
    const secondDraft = store.updateDraft(first.draft.id, {
      revision: first.draft.revision,
      snapshot: nextSnapshot,
      reason: '1本目だけASP経由へ変更',
    });
    const second = store.saveVersion(secondDraft.id, secondDraft.revision);
    const versions = store.detail(detail.case.id).versions;
    expect(versions[1].snapshot).toEqual(firstSnapshot);
    expect(second.draft.snapshot.mediaLines).toEqual(changedLines);
    expect(second.draft.snapshot.mediaLines[1]).toEqual(lines[1]);
    expect(second.draft.snapshot.graph.nodes.some((node) => node.id === 'web-aa-asp-line')).toBe(
      true,
    );
    expect(second.draft.snapshot.graph.nodes.some((node) => node.id === 'web-aa')).toBe(true);
  });

  it('Web・アプリ・電話・LINEを1つのグラフとして保存できる', () => {
    const detail = store.createCase({
      ...input,
      answers: { ...input.answers, measurements: ['web', 'app', 'phone', 'line'] },
    });
    const { version } = store.saveVersion(detail.draft!.id, detail.draft!.revision);
    expect(version.status).toBe('unresolved');
    expect(version.snapshot.schemaVersion).toBe(3);
    expect(version.snapshot.graph.id).toBe('main');
    expect(version.snapshot.answers.measurements).toEqual(['web', 'app', 'phone', 'line']);
    const measurements = new Set(
      version.snapshot.graph.nodes.map((node) => node.measurement).filter(Boolean),
    );
    expect(measurements.has('app')).toBe(true);
    expect(measurements.has('phone')).toBe(true);
    expect(measurements.has('line')).toBe(true);
    expect(version.snapshot).not.toHaveProperty('routes');
    store.close();
    store = createStore(join(directory, 'test.sqlite'));
    expect(store.detail(detail.case.id).versions[0]).toEqual(version);
  });

  it('古い下書き改訂からの更新・連続保存を拒否する', () => {
    const detail = createCase();
    const initial = detail.draft!;
    const updated = changeDraft(initial);
    expect(() =>
      store.updateDraft(initial.id, {
        revision: initial.revision,
        snapshot: initial.snapshot,
        reason: '古い操作',
      }),
    ).toThrow('別の操作で下書きが更新');
    expect(() => store.saveVersion(initial.id, initial.revision)).toThrow('別の操作で下書きが更新');
    const saved = store.saveVersion(updated.id, updated.revision);
    expect(() => store.saveVersion(updated.id, updated.revision)).toThrow('別の操作で下書きが更新');
    expect(store.detail(detail.case.id).versions).toHaveLength(1);
    expect(store.detail(detail.case.id).case.headVersionId).toBe(saved.version.id);
  });

  it('古い編集開始時headでの編集開始と無断下書き置換を拒否する', () => {
    const detail = createCase();
    const first = store.saveVersion(detail.draft!.id, detail.draft!.revision);
    expect(() =>
      store.startDraft(detail.case.id, {
        baseVersionId: first.version.id,
        expectedHeadId: null,
        replaceRevision: first.draft.revision,
      }),
    ).toThrow('別の操作で新しいバージョン');
    expect(() =>
      store.startDraft(detail.case.id, {
        baseVersionId: first.version.id,
        expectedHeadId: first.version.id,
      }),
    ).toThrow('既存の下書きがあります');
    expect(() =>
      store.startDraft(detail.case.id, {
        baseVersionId: first.version.id,
        expectedHeadId: first.version.id,
        replaceRevision: first.draft.revision - 1,
      }),
    ).toThrow('別の操作で下書きが更新');
    expect(store.detail(detail.case.id).draft).toEqual(first.draft);
  });

  it('最新headを把握したうえで過去版から新しい版を作成できる', () => {
    const detail = createCase();
    const first = store.saveVersion(detail.draft!.id, detail.draft!.revision);
    const changed = changeDraft(first.draft);
    const second = store.saveVersion(changed.id, changed.revision);
    const restored = store.startDraft(detail.case.id, {
      baseVersionId: first.version.id,
      expectedHeadId: second.version.id,
      replaceRevision: second.draft.revision,
    });
    expect(restored.snapshot).toEqual(first.version.snapshot);
    expect(restored.expectedHeadId).toBe(second.version.id);
    expect(restored.baseVersionId).toBe(first.version.id);
    const updated = store.updateDraft(restored.id, {
      revision: restored.revision,
      snapshot: restored.snapshot,
      reason: '過去の構成に戻す',
    });
    const third = store.saveVersion(updated.id, updated.revision);
    expect(third.version.number).toBe(3);
    expect(third.version.baseVersionId).toBe(first.version.id);
    expect(store.detail(detail.case.id).versions).toHaveLength(3);
  });

  it('保存失敗時に連番・最新版・下書きの部分更新を残さない', () => {
    const detail = createCase();
    const draft = store.updateDraft(detail.draft!.id, {
      revision: detail.draft!.revision,
      snapshot: detail.draft!.snapshot,
      reason: '   ',
    });
    expect(() => store.saveVersion(draft.id, draft.revision)).toThrow('変更理由');
    const after = store.detail(detail.case.id);
    expect(after.case.headVersionId).toBeNull();
    expect(after.versions).toEqual([]);
    expect(after.draft).toEqual(draft);
    const fixed = store.updateDraft(draft.id, {
      revision: draft.revision,
      snapshot: draft.snapshot,
      reason: '初回保存',
    });
    expect(store.saveVersion(fixed.id, fixed.revision).version.number).toBe(1);
  });

  it('別案件の版を編集元に指定しても下書きを変更しない', () => {
    const one = createCase();
    const two = createCase();
    const saved = store.saveVersion(one.draft!.id, one.draft!.revision);
    expect(() =>
      store.startDraft(two.case.id, {
        baseVersionId: saved.version.id,
        expectedHeadId: null,
        replaceRevision: two.draft!.revision,
      }),
    ).toThrow('この案件のバージョン');
    expect(store.detail(two.case.id)).toEqual(two);
  });

  it('壊れた接続先を含むデータの保存を拒否して下書きを保持する', () => {
    const detail = createCase();
    const invalid = structuredClone(detail.draft!.snapshot);
    invalid.graph.edges[0].target = 'missing-node';
    expect(() =>
      store.updateDraft(detail.draft!.id, {
        revision: detail.draft!.revision,
        snapshot: invalid,
        reason: '不正',
      }),
    ).toThrow('導線データが不正');
    expect(store.detail(detail.case.id).draft).toEqual(detail.draft);
  });
});

describe('HTTP API', () => {
  it('案件作成・下書き更新・版保存・履歴読込を実行できる', async () => {
    const base = await startApi();
    const created = await request(base, '/api/cases', 'POST', input);
    expect(created.status).toBe(201);
    const detail = (await created.json()) as CaseDetail;
    const updated = await request(base, `/api/drafts/${detail.draft!.id}`, 'PUT', {
      revision: detail.draft!.revision,
      snapshot: detail.draft!.snapshot,
      reason: '初回確認',
    });
    expect(updated.status).toBe(200);
    const { draft } = (await updated.json()) as { draft: Draft };
    const saved = await request(base, `/api/drafts/${draft.id}/versions`, 'POST', {
      revision: draft.revision,
    });
    expect(saved.status).toBe(201);
    const { version } = (await saved.json()) as { version: Version };
    const loaded = await request(base, `/api/cases/${detail.case.id}`);
    expect(((await loaded.json()) as CaseDetail).versions[0]).toEqual(version);
  });

  it('入力不備・未知ID・異なるOriginからの更新を日本語エラーで拒否する', async () => {
    const base = await startApi();
    const bad = await request(base, '/api/cases', 'POST', { ...input, name: '   ' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toHaveProperty('error');
    const selection = await request(base, '/api/cases', 'POST', {
      ...input,
      answers: { ...input.answers, measurements: [] },
    });
    expect(selection.status).toBe(400);
    const caseLevelPath = await request(base, '/api/cases', 'POST', {
      ...input,
      answers: { ...input.answers, isDirect: true },
    });
    expect(caseLevelPath.status).toBe(400);
    expect((await request(base, '/api/cases/missing')).status).toBe(404);
    const cross = await request(base, '/api/cases', 'POST', input, {
      Origin: 'https://unrelated.example',
    });
    expect(cross.status).toBe(403);
    expect(store.listCases()).toEqual([]);
    const allowed = await request(base, '/api/cases', 'POST', input, {
      Origin: 'http://127.0.0.1:5173',
    });
    expect(allowed.status).toBe(201);
  });

  it('不正JSON・不正グラフ・古いrevisionの操作は失敗しても案件を壊さない', async () => {
    const base = await startApi();
    const malformed = await fetch(`${base}/api/cases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid',
    });
    expect(malformed.status).toBe(400);
    const detail = createCase();
    const invalid: Snapshot = structuredClone(detail.draft!.snapshot);
    invalid.graph.edges[0].target = 'missing-node';
    const rejected = await request(base, `/api/drafts/${detail.draft!.id}`, 'PUT', {
      revision: detail.draft!.revision,
      snapshot: invalid,
      reason: '不正',
    });
    expect(rejected.status).toBe(400);
    const saved = await request(base, `/api/drafts/${detail.draft!.id}/versions`, 'POST', {
      revision: detail.draft!.revision,
    });
    expect(saved.status).toBe(201);
    const conflict = await request(base, `/api/drafts/${detail.draft!.id}/versions`, 'POST', {
      revision: detail.draft!.revision,
    });
    expect(conflict.status).toBe(409);
    expect(store.detail(detail.case.id).versions).toHaveLength(1);
  });
});

it('設定した開発UIポートのみ更新を許可し、別ポートや外部サイトは拒否する', async () => {
  const base = await startApi('http://127.0.0.1:5174');
  for (const origin of ['http://127.0.0.1:5174', 'http://localhost:5174']) {
    const response = await request(base, '/api/cases', 'POST', input, { Origin: origin });
    expect(response.status).toBe(201);
  }
  for (const origin of ['http://127.0.0.1:5173', 'http://127.0.0.1:5175', 'https://example.test']) {
    const response = await request(base, '/api/cases', 'POST', input, { Origin: origin });
    expect(response.status).toBe(403);
  }
});

it('APIからWeb・アプリ・電話・LINEの同時選択を受け取り単一グラフを保存・返却する', async () => {
  const base = await startApi();
  const created = await request(base, '/api/cases', 'POST', {
    ...input,
    answers: { postback: false, measurements: ['web', 'app', 'phone', 'line'] },
  });
  expect(created.status).toBe(201);
  const detail = (await created.json()) as CaseDetail;
  expect(detail.draft!.snapshot.schemaVersion).toBe(3);
  expect(detail.draft!.snapshot.graph.id).toBe('main');
  const saved = await request(base, `/api/drafts/${detail.draft!.id}/versions`, 'POST', {
    revision: detail.draft!.revision,
  });
  expect(saved.status).toBe(201);
  const loaded = await request(base, `/api/cases/${detail.case.id}`);
  const restored = (await loaded.json()) as CaseDetail;
  expect(restored.versions[0].snapshot).toEqual(detail.draft!.snapshot);
  const invalid = await request(base, '/api/cases', 'POST', {
    ...input,
    answers: { postback: false, measurements: ['web', 'app', 'phone', 'line', 'line'] },
  });
  expect(invalid.status).toBe(400);
});
