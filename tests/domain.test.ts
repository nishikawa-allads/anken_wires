import { describe, expect, it } from 'vitest';
import {
  generateSnapshot,
  getIssues,
  regenerateSnapshot,
  validateAnswers,
  validateSnapshot,
  normalizeSnapshot,
  getCanvasGraph,
  validateLegacyV2Snapshot,
  validateLegacySnapshot,
  validateMediaLines,
} from '../shared/domain';
import { generateSnapshot as generateLegacySnapshot } from '../shared/legacy-domain';
import { generateSnapshot as generateV2Snapshot } from '../shared/legacy-v2-domain';
import type { Answers, MediaLine, Measurement } from '../shared/types';

const answers: Answers = { postback: false, measurements: ['web'] };
const lines = (isDirect: boolean): MediaLine[] => [
  { id: 'default', name: 'メディアライン1', isDirect },
];

describe('導線の生成', () => {
  it.each([
    [true, false, ['media', 'lp', 'thanks', 'alladin']],
    [false, false, ['media', 'aa', 'lp', 'thanks', 'alladin']],
    [false, true, ['media', 'aa', 'lp', 'thanks', 'cl', 'alladin']],
    [true, true, ['media', 'lp', 'thanks', 'cl', 'alladin']],
  ] as const)(
    'ASPとCLポストバックを独立して扱う: direct=%s postback=%s',
    (isDirect, postback, roles) => {
      const snapshot = generateSnapshot({ ...answers, postback }, lines(isDirect));
      const route = snapshot.graph;
      expect(route.nodes.map((n) => n.role)).toEqual(roles);
      expect(route.nodes.find((n) => n.role === 'thanks')?.tag?.usage).toBe(
        postback ? 'disabled' : 'enabled',
      );
      expect(route.nodes.find((n) => n.role === 'lp')?.tag?.usage).toBe('enabled');
      expect(route.edges.find((e) => e.target === 'web-lp')?.identifier).toBe('affnmsid');
      expect(route.edges.find((e) => e.target === 'web-alladin')?.kind).toBe('notification');
      expect(validateSnapshot(snapshot)).toEqual(snapshot);
    },
  );

  it('Web・電話・アプリ・LINEを同じ図に収め、LINEとアプリを混同しない', () => {
    const value: Answers = { ...answers, measurements: ['phone', 'web', 'app', 'line'] };
    const snapshot = generateSnapshot(value);
    expect(snapshot).toEqual(generateSnapshot(value));
    expect(snapshot.answers.measurements).toEqual(['web', 'app', 'phone', 'line']);
    expect(snapshot).not.toHaveProperty('routes');
    expect(snapshot.graph.nodes.filter((node) => node.role === 'lp')).toHaveLength(1);
    expect(snapshot.graph.nodes.filter((node) => node.id === 'web-alladin')).toHaveLength(1);
    expect(snapshot.graph.nodes.find((node) => node.id === 'app-placeholder')?.measurement).toBe(
      'app',
    );
    expect(snapshot.graph.nodes.find((node) => node.id === 'line-friend-add')?.measurement).toBe(
      'line',
    );
    expect(
      snapshot.graph.edges.some(
        (edge) => edge.source === 'app-placeholder' || edge.target === 'app-placeholder',
      ),
    ).toBe(false);
    expect(
      snapshot.graph.edges.some(
        (edge) => edge.source === 'web-lp' && edge.target === 'line-friend-add',
      ),
    ).toBe(true);
    expect(snapshot.graph.status).toBe('unresolved');
    expect(validateSnapshot(snapshot)).toEqual(snapshot);
  });
});

describe('回答変更と再生成', () => {
  it('手動変更したURL・配置・注記・タグ例外と接続情報を残し、元データを変えない', () => {
    const original = generateSnapshot(answers);
    const lp = original.graph.nodes.find((n) => n.role === 'lp')!;
    lp.url = 'https://example.test/lp';
    lp.note = '確認済み';
    lp.position = { x: 42, y: 67 };
    lp.manual = ['url', 'note', 'position'];
    const thanks = original.graph.nodes.find((n) => n.role === 'thanks')!;
    thanks.tag = {
      usage: 'enabled',
      source: 'manual',
      destination: 'CL独自ツール',
      role: '補助計測',
      condition: '完了時',
    };
    original.graph.edges[0].manual = true;
    original.graph.edges[0].identifier = 'affnmsid, media_param';
    const copy = structuredClone(original);
    const result = regenerateSnapshot(original, { ...answers, postback: true });
    expect(original).toEqual(copy);
    expect(result.snapshot.graph.nodes.find((n) => n.role === 'lp')).toMatchObject({
      url: lp.url,
      position: lp.position,
      note: lp.note,
    });
    expect(result.snapshot.graph.nodes.find((n) => n.role === 'thanks')?.tag).toEqual(thanks.tag);
    expect(result.snapshot.graph.edges[0].identifier).toBe('affnmsid, media_param');
    expect(getIssues(result.snapshot).some((s) => s.includes('二重計測'))).toBe(true);
  });

  it('ポストバックとALLADiN向けCVタグの併用を別の通知経路として表現する', () => {
    const old = generateSnapshot({ ...answers, postback: true });
    const thanks = old.graph.nodes.find((n) => n.role === 'thanks')!;
    thanks.tag = {
      usage: 'enabled',
      source: 'manual',
      destination: 'ALLADiN',
      role: '補助CV',
      condition: '',
    };
    const result = regenerateSnapshot(old, old.answers).snapshot;
    expect(
      result.graph.edges
        .filter((e) => e.target === 'web-alladin')
        .map((e) => e.source)
        .sort(),
    ).toEqual(['web-cl', 'web-thanks']);
    expect(validateSnapshot(result)).toEqual(result);
    const disabled = structuredClone(result);
    disabled.graph.nodes.find((n) => n.role === 'thanks')!.tag!.usage = 'disabled';
    const withoutTag = regenerateSnapshot(disabled, disabled.answers).snapshot;
    expect(
      withoutTag.graph.edges.filter((e) => e.target === 'web-alladin').map((e) => e.source),
    ).toEqual(['web-cl']);
    expect(validateSnapshot(withoutTag)).toEqual(withoutTag);
  });

  it('タグ有効化後にCL名称を変更しても、再生成後の構造を検証できる', () => {
    const old = generateSnapshot({ ...answers, postback: true });
    const thanks = old.graph.nodes.find((n) => n.role === 'thanks')!;
    thanks.tag = {
      usage: 'enabled',
      source: 'manual',
      destination: 'CLの計測ツール',
      role: 'CL側補助計測',
      condition: '完了時',
    };
    const enabled = regenerateSnapshot(old, old.answers).snapshot;
    expect(enabled.graph.edges.some((e) => e.id === 'web-thanks-cl-cvtag')).toBe(true);
    const cl = enabled.graph.nodes.find((n) => n.role === 'cl')!;
    cl.title = '案件固有のCLツール';
    cl.system = '案件固有の計測基盤';
    cl.manual = ['title', 'system'];
    const renamed = regenerateSnapshot(enabled, enabled.answers).snapshot;
    expect(validateSnapshot(renamed)).toEqual(renamed);
    expect(renamed.graph.nodes.find((n) => n.role === 'cl')?.title).toBe(cl.title);
    // 名前の一致がなくなった送信先を、新しいツールに誤って紐づけない。
    expect(renamed.graph.edges.some((e) => e.id === 'web-thanks-cl-cvtag')).toBe(false);
    expect(getIssues(renamed).some((issue) => issue.includes('対応する計測経路'))).toBe(true);
    renamed.graph.nodes.find((n) => n.role === 'thanks')!.tag!.destination = cl.title;
    const matched = regenerateSnapshot(renamed, renamed.answers).snapshot;
    expect(matched.graph.edges.some((e) => e.id === 'web-thanks-cl-cvtag')).toBe(true);
    expect(validateSnapshot(matched)).toEqual(matched);
  });

  it('任意のタグ送信先をALLADiNに決め打ちせず、CLへの通知は別経路で表す', () => {
    const old = generateSnapshot({ ...answers, postback: true });
    const thanks = old.graph.nodes.find((n) => n.role === 'thanks')!;
    thanks.tag = {
      usage: 'enabled',
      source: 'manual',
      destination: '独自の計測システム',
      role: '補助計測',
      condition: '',
    };
    const unknown = regenerateSnapshot(old, old.answers).snapshot;
    expect(unknown.graph.edges.some((e) => e.id === 'web-thanks-alladin')).toBe(false);
    expect(getIssues(unknown).some((issue) => issue.includes('独自の計測システム'))).toBe(true);
    expect(validateSnapshot(unknown)).toEqual(unknown);
    thanks.tag.destination = 'CL';
    const cl = regenerateSnapshot(old, old.answers).snapshot;
    expect(cl.graph.edges.find((e) => e.id === 'web-thanks-cl-cvtag')?.target).toBe('web-cl');
    expect(validateSnapshot(cl)).toEqual(cl);
  });

  it('利用者が明示していないタグ初期値は新しい受信方式に追従する', () => {
    const result = regenerateSnapshot(generateSnapshot(answers), { ...answers, postback: true });
    expect(result.snapshot.graph.nodes.find((n) => n.role === 'thanks')?.tag?.usage).toBe(
      'disabled',
    );
  });

  it('消えるノードのURLや配置、消える接続の手動変更を確認用に返す', () => {
    const old = generateSnapshot(answers, lines(false));
    const aa = old.graph.nodes.find((n) => n.role === 'aa')!;
    aa.url = 'https://example.test/aa';
    aa.position = { x: 150, y: 400 };
    aa.manual = ['url', 'position'];
    old.graph.edges[0].manual = true;
    old.graph.edges[0].label = 'ASP経由の入口';
    const result = regenerateSnapshot(old, answers, lines(true));
    expect(result.removed.join(' ')).toContain(aa.url);
    expect(result.removed.join(' ')).toContain('150, 400');
    expect(result.removed.join(' ')).toContain('ASP経由の入口');
    expect(result.snapshot.graph.nodes.some((n) => n.role === 'aa')).toBe(false);
  });

  it('電話枝を削除する前に手動注記や通知の変更を確認でき、Webを保つ', () => {
    const old = generateSnapshot({ ...answers, measurements: ['web', 'phone'] });
    const note = old.graph.nodes.find((node) => node.id === 'phone-placeholder')!;
    note.note = '電話CV条件は通話開始';
    note.manual = ['note'];
    const link = old.graph.edges.find((edge) => edge.id === 'phone-records-batch')!;
    link.label = '独自の取得処理';
    link.manual = true;
    const result = regenerateSnapshot(old, answers);
    expect(result.removed.join(' ')).toContain(note.note);
    expect(result.removed.join(' ')).toContain(link.label);
    expect(result.snapshot.graph.nodes.some((node) => node.measurement === 'phone')).toBe(false);
    expect(result.snapshot.graph.nodes.find((node) => node.id === 'web-lp')).toEqual(
      old.graph.nodes.find((node) => node.id === 'web-lp'),
    );
    expect(validateSnapshot(result.snapshot)).toEqual(result.snapshot);
  });
});

describe('保存する構造の検証', () => {
  it('ノード・接続の重複、存在しない接続先、非有限の配置を拒否する', () => {
    const duplicate = generateSnapshot(answers);
    duplicate.graph.nodes[1].id = duplicate.graph.nodes[0].id;
    expect(() => validateSnapshot(duplicate)).toThrow('重複');
    const dangling = generateSnapshot(answers);
    dangling.graph.edges[0].target = 'missing';
    expect(() => validateSnapshot(dangling)).toThrow('存在しません');
    const nonfinite = generateSnapshot(answers);
    nonfinite.graph.nodes[0].position.x = Infinity;
    expect(() => validateSnapshot(nonfinite)).toThrow('有限');
    const duplicateEdge = generateSnapshot(answers);
    duplicateEdge.graph.edges[1].id = duplicateEdge.graph.edges[0].id;
    expect(() => validateSnapshot(duplicateEdge)).toThrow('重複');
  });

  it('回答と導線の種別・構造の不一致と未対応の形式版を拒否する', () => {
    const inconsistent = generateSnapshot(answers);
    inconsistent.answers.postback = true;
    expect(() => validateSnapshot(inconsistent)).toThrow('ノード構成');
    const wrongType = generateSnapshot(answers);
    wrongType.graph.nodes[0].measurement = 'phone';
    expect(() => validateSnapshot(wrongType)).toThrow('一致しません');
    const future = { ...generateSnapshot(answers), schemaVersion: 4 };
    expect(() => validateSnapshot(future)).toThrow('バージョン');
  });

  it('計測種別なし・重複・不明な値、手動更新対象の不正値を拒否する', () => {
    expect(() => validateAnswers({ ...answers, measurements: [] })).toThrow();
    expect(() => validateAnswers({ ...answers, measurements: ['web', 'web'] })).toThrow();
    expect(() => validateAnswers({ ...answers, measurements: ['email'] })).toThrow();
    const invalid = generateSnapshot(answers);
    invalid.graph.nodes[0].manual = ['id'];
    expect(() => validateSnapshot(invalid)).toThrow('手動編集対象');
  });

  it('保存用データを複製して呼び出し元の変更から保護する', () => {
    const source = generateSnapshot(answers);
    const validated = validateSnapshot(source);
    validated.graph.nodes[0].title = '変更後';
    expect(source.graph.nodes[0].title).toBe('メディアライン1');
  });
});

describe('メディアライン単位の入稿経路', () => {
  const mixed: MediaLine[] = [
    { id: 'default', name: '直メディアライン', isDirect: true },
    { id: 'asp', name: 'ASPメディアライン', isDirect: false },
  ];
  it('同一案件に直入稿とASP経由を混在させ、共通LPへ接続する', () => {
    const snapshot = generateSnapshot(answers, mixed);
    expect(snapshot.answers).not.toHaveProperty('isDirect');
    expect(snapshot.mediaLines).toEqual(mixed);
    const route = snapshot.graph;
    expect(route.nodes.find((n) => n.id === 'web-media')).toMatchObject({
      title: mixed[0].name,
      mediaLineId: 'default',
    });
    expect(route.nodes.find((n) => n.id === 'web-media-asp')).toMatchObject({
      title: mixed[1].name,
      mediaLineId: 'asp',
    });
    expect(route.nodes.some((n) => n.id === 'web-aa')).toBe(false);
    expect(route.nodes.find((n) => n.id === 'web-aa-asp')?.mediaLineId).toBe('asp');
    expect(route.nodes.filter((n) => n.role === 'lp')).toHaveLength(1);
    expect(
      route.edges
        .filter((e) => e.target === 'web-lp')
        .map((e) => e.source)
        .sort(),
    ).toEqual(['web-aa-asp', 'web-media']);
    expect(validateSnapshot(snapshot)).toEqual(snapshot);
  });

  it('一方の入稿経路変更は他のメディアラインの属性と接続を変えない', () => {
    const old = generateSnapshot(answers, mixed);
    const independent = old.graph.nodes.find((n) => n.id === 'web-media-asp')!;
    independent.url = 'https://example.test/asp';
    independent.note = '別のラインの設定';
    independent.manual = ['url', 'note'];
    const changed = regenerateSnapshot(
      old,
      old.answers,
      mixed.map((line) => (line.id === 'default' ? { ...line, isDirect: false } : line)),
    ).snapshot;
    expect(changed.mediaLines[1]).toEqual(mixed[1]);
    expect(changed.graph.nodes.find((n) => n.id === independent.id)).toEqual(independent);
    expect(changed.graph.nodes.some((n) => n.id === 'web-aa')).toBe(true);
    expect(changed.graph.nodes.some((n) => n.id === 'web-aa-asp')).toBe(true);
    expect(validateSnapshot(changed)).toEqual(changed);
  });

  it('案件の回答変更でメディアラインの入稿経路を初期化しない', () => {
    const old = generateSnapshot(answers, mixed);
    const result = regenerateSnapshot(old, {
      ...answers,
      postback: true,
      measurements: ['web', 'phone'],
    }).snapshot;
    expect(result.mediaLines).toEqual(mixed);
    expect(result.graph.nodes.some((n) => n.id === 'web-aa-asp')).toBe(true);
    expect(validateSnapshot(result)).toEqual(result);
  });

  it('ライン名の変更を優先し、古いmanual titleで戻さない', () => {
    const old = generateSnapshot(answers, mixed);
    old.graph.nodes[0].manual = ['title'];
    const renamed = regenerateSnapshot(old, old.answers, [
      { ...mixed[0], name: '変更後のメディアライン' },
      mixed[1],
    ]).snapshot;
    expect(renamed.graph.nodes[0].title).toBe('変更後のメディアライン');
    expect(validateSnapshot(renamed)).toEqual(renamed);
  });

  it('メディアラインの削除でURL・位置・接続の手動調整消失を返す', () => {
    const old = generateSnapshot(answers, mixed);
    const media = old.graph.nodes.find((n) => n.id === 'web-media-asp')!;
    media.url = 'https://example.test/source';
    media.position = { x: 32, y: 456 };
    media.manual = ['url', 'position'];
    const connection = old.graph.edges.find((e) => e.source === media.id)!;
    connection.manual = true;
    connection.identifier = 'ASPクリック識別子';
    const result = regenerateSnapshot(old, old.answers, [mixed[0]]);
    expect(result.removed.join(' ')).toContain(media.url);
    expect(result.removed.join(' ')).toContain('32, 456');
    expect(result.removed.join(' ')).toContain('ASPクリック識別子');
    expect(result.snapshot.graph.nodes.some((n) => n.mediaLineId === 'asp')).toBe(false);
    expect(validateSnapshot(result.snapshot)).toEqual(result.snapshot);
  });

  it('案件への入稿経路指定・不正なライン・ラインとノードの不整合を拒否する', () => {
    expect(() => validateAnswers({ ...answers, isDirect: false })).toThrow('メディアライン');
    expect(() => validateMediaLines([])).toThrow();
    expect(() => validateMediaLines([{ ...mixed[0], name: ' ' }])).toThrow();
    expect(() => validateMediaLines([mixed[0], mixed[0]])).toThrow('重複');
    expect(() => validateMediaLines([{ ...mixed[0], id: 'invalid/id' }])).toThrow();
    const invalid = generateSnapshot(answers, mixed);
    invalid.graph.nodes[0].mediaLineId = 'asp';
    expect(() => validateSnapshot(invalid)).toThrow('メディアライン');
    const wrongName = generateSnapshot(answers, mixed);
    wrongName.graph.nodes[0].title = '不一致';
    expect(() => validateSnapshot(wrongName)).toThrow('メディアライン名');
  });
});

describe('保存済みv1の互換性', () => {
  it.each([true, false])(
    '旧入稿経路を1つのラインへ移し、保存版を変更しない: direct=%s',
    (isDirect) => {
      const legacy = generateLegacySnapshot({ ...answers, isDirect });
      const media = legacy.routes[0].nodes.find((n) => n.role === 'media')!;
      media.title = '既存のメディアライン名';
      media.manual = ['title', 'url', 'position'];
      media.url = 'https://example.test/legacy';
      media.position = { x: -45, y: 456 };
      const original = structuredClone(legacy);
      expect(validateLegacySnapshot(legacy)).toEqual(legacy);
      const upgraded = normalizeSnapshot(legacy);
      expect(legacy).toEqual(original);
      expect(upgraded.answers).toEqual(answers);
      expect(upgraded.mediaLines).toEqual([{ id: 'default', name: media.title, isDirect }]);
      expect(upgraded.graph.nodes.find((n) => n.role === 'media')).toMatchObject({
        id: 'web-media',
        mediaLineId: 'default',
        url: media.url,
        position: media.position,
        title: media.title,
      });
      expect(upgraded.graph.edges).toEqual(legacy.routes[0].edges);
      expect(validateSnapshot(upgraded)).toEqual(upgraded);
      expect(() => validateSnapshot(legacy)).toThrow('バージョン');
      const edited = regenerateSnapshot(upgraded, upgraded.answers, [
        { ...upgraded.mediaLines[0], name: '編集後' },
      ]).snapshot;
      expect(edited.graph.nodes[0].title).toBe('編集後');
      expect(validateSnapshot(edited)).toEqual(edited);
      expect(legacy).toEqual(original);
    },
  );

  it.each([121, 10000])(
    '旧版の長い名前をURL・配置とともに保持し、新形式で保存検証できる: %s文字',
    (length) => {
      const legacy = generateLegacySnapshot({ ...answers, isDirect: false });
      const media = legacy.routes[0].nodes.find((node) => node.role === 'media')!;
      media.title = '旧'.repeat(length);
      media.url = 'https://example.test/long-legacy-name';
      media.position = { x: -123, y: 456 };
      media.manual = ['title', 'url', 'position'];
      const before = JSON.stringify(legacy);
      const upgraded = normalizeSnapshot(legacy);
      expect(upgraded.mediaLines[0].name).toBe(media.title);
      expect(upgraded.graph.nodes[0]).toMatchObject({
        title: media.title,
        url: media.url,
        position: media.position,
      });
      // 永続化時と同じJSON往復・保存境界の検証でも既存値を維持する。
      expect(validateSnapshot(JSON.parse(JSON.stringify(upgraded)))).toEqual(upgraded);
      const regenerated = regenerateSnapshot(upgraded, upgraded.answers).snapshot;
      expect(regenerated.mediaLines[0].name).toBe(media.title);
      expect(regenerated.graph.nodes[0]).toMatchObject({
        title: media.title,
        url: media.url,
        position: media.position,
      });
      expect(validateSnapshot(regenerated)).toEqual(regenerated);
      expect(JSON.stringify(legacy)).toBe(before);
    },
  );

  it('旧標準名を新用語へ変換し、未確定種別のみの版も読み込む', () => {
    const legacy = generateLegacySnapshot({ ...answers, isDirect: false });
    const normalized = normalizeSnapshot(legacy);
    expect(normalized.graph.nodes[0].title).toBe('メディアライン1');
    expect(normalized.graph.nodes[0].system).toBe('メディアライン');
    const phone = generateLegacySnapshot({
      isDirect: false,
      postback: true,
      measurements: ['phone'],
    });
    expect(normalizeSnapshot(phone).mediaLines[0].isDirect).toBe(false);
    expect(normalizeSnapshot(phone).graph.status).toBe('unresolved');
    expect(getIssues(legacy).length).toBeGreaterThan(0);
  });

  it('旧版の不正構造を新形式として黙って取り込まない', () => {
    const invalid = generateLegacySnapshot({ ...answers, isDirect: true });
    invalid.routes[0].edges[0].target = '存在しないノード';
    expect(() => normalizeSnapshot(invalid)).toThrow();
    expect(() => normalizeSnapshot({ ...invalid, schemaVersion: 4 })).toThrow('バージョン');
  });
});

describe('統合キャンバスの電話・LINE・アプリ枝', () => {
  it('電話接続と記録通知・API取得を区別し、共通LPとALLADiNに結ぶ', () => {
    const snapshot = generateSnapshot({ postback: false, measurements: ['web', 'phone'] });
    const graph = snapshot.graph;
    for (const role of [
      'call-data-bank',
      'call-tracker',
      'call-center',
      'phone-records',
      'tracker-records',
      'phone-batch',
      'phone_note',
    ]) {
      expect(graph.nodes.some((node) => node.role === role && node.measurement === 'phone')).toBe(
        true,
      );
    }
    expect(graph.edges.find((edge) => edge.id === 'phone-lp-call-data-bank')).toMatchObject({
      source: 'web-lp',
      target: 'phone-call-data-bank',
      kind: 'phone',
    });
    expect(graph.edges.find((edge) => edge.id === 'phone-tracker-center')?.kind).toBe('phone');
    expect(graph.edges.find((edge) => edge.id === 'phone-data-bank-records')?.kind).toBe(
      'notification',
    );
    expect(graph.edges.find((edge) => edge.id === 'phone-records-batch')).toMatchObject({
      source: 'phone-records',
      target: 'phone-batch',
      kind: 'notification',
    });
    expect(graph.edges.find((edge) => edge.id === 'phone-batch-alladin')).toMatchObject({
      target: 'web-alladin',
      identifier: 'affnmsid',
    });
    expect(graph.nodes.filter((node) => node.role === 'lp')).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.role === 'alladin')).toHaveLength(1);
    expect(getIssues(snapshot).some((issue) => issue.includes('参考'))).toBe(true);
    expect(validateSnapshot(snapshot)).toEqual(snapshot);
  });

  it.each([
    { selected: ['web'] },
    { selected: ['phone'] },
    { selected: ['line'] },
    { selected: ['app'] },
    { selected: ['web', 'phone'] },
    { selected: ['web', 'app', 'phone', 'line'] },
  ] as { selected: Measurement[] }[])(
    '選択された計測 $selected だけを同じ図へ生成する',
    ({ selected }) => {
      const snapshot = generateSnapshot({ postback: true, measurements: [...selected] });
      const sharedLP = selected.some(
        (item) => item === 'web' || item === 'phone' || item === 'line',
      );
      expect(snapshot.graph.nodes.some((node) => node.id === 'web-lp')).toBe(sharedLP);
      expect(snapshot.graph.nodes.some((node) => node.id === 'web-thanks')).toBe(
        selected.some((item) => item === 'web'),
      );
      expect(snapshot.graph.nodes.some((node) => node.id === 'phone-call-data-bank')).toBe(
        selected.some((item) => item === 'phone'),
      );
      expect(snapshot.graph.nodes.some((node) => node.id === 'app-placeholder')).toBe(
        selected.some((item) => item === 'app'),
      );
      expect(snapshot.graph.nodes.some((node) => node.id === 'line-friend-add')).toBe(
        selected.some((item) => item === 'line'),
      );
      expect(validateSnapshot(snapshot)).toEqual(snapshot);
    },
  );

  it('種別の追加で既存のWeb・電話・メディアラインの手動調整を初期化しない', () => {
    const snapshot = generateSnapshot({ ...answers, measurements: ['web', 'phone'] }, [
      { id: 'default', name: '直接ライン', isDirect: true },
      { id: 'asp', name: 'ASPライン', isDirect: false },
    ]);
    const bank = snapshot.graph.nodes.find((node) => node.id === 'phone-call-data-bank')!;
    bank.title = '案件固有の電話計測';
    bank.url = 'https://phone.example.test';
    bank.position = { x: -450, y: 1750 };
    bank.manual = ['title', 'url', 'position'];
    const lp = snapshot.graph.nodes.find((node) => node.id === 'web-lp')!;
    lp.note = '共通LPの注記';
    lp.manual = ['note'];
    const edge = snapshot.graph.edges.find((item) => item.id === 'phone-lp-records')!;
    edge.identifier = 'affnmsid, display_number';
    edge.manual = true;
    const original = structuredClone(snapshot);
    const changed = regenerateSnapshot(snapshot, {
      ...snapshot.answers,
      measurements: ['web', 'phone', 'app', 'line'],
    }).snapshot;
    expect(changed.graph.nodes.find((node) => node.id === bank.id)).toEqual(bank);
    expect(changed.graph.nodes.find((node) => node.id === lp.id)).toEqual(lp);
    expect(changed.graph.edges.find((item) => item.id === edge.id)).toEqual(edge);
    expect(changed.mediaLines).toEqual(snapshot.mediaLines);
    expect(snapshot).toEqual(original);
    expect(validateSnapshot(changed)).toEqual(changed);
  });

  it('種別の誤表示・別図形式・不正な電話接続を保存境界で拒否する', () => {
    const snapshot = generateSnapshot({ ...answers, measurements: ['web', 'phone', 'line'] });
    const wrongKind = structuredClone(snapshot);
    wrongKind.graph.edges.find((edge) => edge.id === 'phone-tracker-center')!.kind = 'notification';
    expect(() => validateSnapshot(wrongKind)).toThrow('接続');
    const wrongMeasurement = structuredClone(snapshot);
    wrongMeasurement.graph.nodes.find((node) => node.id === 'line-friend-add')!.measurement = 'app';
    expect(() => validateSnapshot(wrongMeasurement)).toThrow('計測種別');
    expect(() => validateSnapshot({ ...snapshot, routes: [] })).toThrow('別図');
  });
});

describe('旧V2の統合表示と編集用移行', () => {
  it('旧図を再生成せず合成し、現在の電話テンプレートを保存版の表示へ混ぜない', () => {
    const old = generateV2Snapshot({ ...answers, measurements: ['web', 'app', 'phone'] });
    const web = old.routes[0];
    web.nodes[0].title = old.mediaLines[0].name = '過去版の名称';
    web.edges[0].label = '保存時の接続ラベル';
    const before = JSON.stringify(old);
    expect(validateLegacyV2Snapshot(old)).toEqual(old);
    const graph = getCanvasGraph(old);
    expect(graph.nodes.filter((node) => node.id === 'app-placeholder')).toHaveLength(1);
    expect(graph.nodes.filter((node) => node.id === 'phone-placeholder')).toHaveLength(1);
    expect(graph.nodes.some((node) => node.id === 'phone-call-data-bank')).toBe(false);
    expect(graph.edges[0].label).toBe('保存時の接続ラベル');
    expect(graph.nodes.find((node) => node.id === 'web-media')?.position).toEqual(
      web.nodes[0].position,
    );
    expect(graph.nodes.find((node) => node.id === 'app-placeholder')!.position.y).toBeGreaterThan(
      Math.max(...web.nodes.map((node) => node.position.y)),
    );
    graph.nodes[0].title = '表示コピーの変更';
    expect(JSON.stringify(old)).toBe(before);
  });

  it('旧V2の電話メモ・手動配置・Web設定を新しい1図へ引き継ぎ、元JSONを変えない', () => {
    const old = generateV2Snapshot({ postback: true, measurements: ['web', 'app', 'phone'] }, [
      { id: 'default', name: '旧ASPライン', isDirect: false },
    ]);
    const phone = old.routes.find((route) => route.measurement === 'phone')!;
    phone.note = '独自の電話計測方針';
    phone.nodes[0].title = '電話の確認事項';
    phone.nodes[0].note = '既存メモ';
    phone.nodes[0].position = { x: -222, y: 999 };
    phone.nodes[0].manual = ['title', 'note', 'position'];
    const web = old.routes.find((route) => route.measurement === 'web')!;
    web.nodes[0].url = 'https://legacy.example.test';
    web.nodes[0].manual = ['url'];
    const before = JSON.stringify(old);
    const oldDisplay = getCanvasGraph(old);
    const migrated = normalizeSnapshot(old);
    const note = migrated.graph.nodes.find((node) => node.id === 'phone-placeholder')!;
    expect(note).toMatchObject({
      role: 'phone_note',
      measurement: 'phone',
      title: '電話の確認事項',
      position: oldDisplay.nodes.find((node) => node.id === note.id)!.position,
    });
    expect(note.note).toContain('既存メモ');
    expect(note.note).toContain('独自の電話計測方針');
    expect(migrated.graph.nodes.some((node) => node.id === 'phone-call-data-bank')).toBe(true);
    expect(migrated.graph.nodes.find((node) => node.id === 'web-media')?.url).toBe(
      web.nodes[0].url,
    );
    expect(validateSnapshot(migrated)).toEqual(migrated);
    const next = regenerateSnapshot(migrated, {
      ...migrated.answers,
      measurements: ['web', 'phone', 'app', 'line'],
    }).snapshot;
    expect(next.graph.nodes.find((node) => node.id === note.id)?.note).toBe(note.note);
    expect(JSON.stringify(old)).toBe(before);
  });

  it('V1の標準名のみを表示用に読み替え、保存された名称や接続を保持する', () => {
    const old = generateLegacySnapshot({ ...answers, isDirect: true });
    const before = JSON.stringify(old);
    const graph = getCanvasGraph(old);
    expect(graph.nodes[0].title).toBe('メディアライン1');
    expect(graph.edges).toEqual(old.routes[0].edges);
    expect(JSON.stringify(old)).toBe(before);
  });
});

it('旧ルートとノードの最大長メモを連結しても移行・保存・再生成できる', () => {
  const old = generateV2Snapshot({ ...answers, measurements: ['web', 'phone'] });
  const route = old.routes.find((item) => item.measurement === 'phone')!;
  route.note = 'r'.repeat(10000);
  route.nodes[0].note = 'n'.repeat(10000);
  route.nodes[0].manual = ['note'];
  const original = JSON.stringify(old);
  expect(validateLegacyV2Snapshot(old)).toEqual(old);
  const migrated = normalizeSnapshot(old);
  const note = migrated.graph.nodes.find((item) => item.id === 'phone-placeholder')!.note;
  expect(note).toContain(route.note);
  expect(note).toContain(route.nodes[0].note);
  expect(note).toHaveLength(20001);
  expect(validateSnapshot(migrated)).toEqual(migrated);
  expect(
    regenerateSnapshot(migrated, migrated.answers).snapshot.graph.nodes.find(
      (item) => item.id === 'phone-placeholder',
    )?.note,
  ).toBe(note);
  expect(JSON.stringify(old)).toBe(original);
});

it('旧形式の検証はLINEを新たに許可せず、単独電話の既定ノートは新入口に重ならない', () => {
  expect(() => generateV2Snapshot({ ...answers, measurements: ['line'] })).toThrow();
  expect(() =>
    generateLegacySnapshot({ ...answers, isDirect: true, measurements: ['line'] }),
  ).toThrow();
  const old = generateV2Snapshot({ ...answers, measurements: ['phone'] });
  const migrated = normalizeSnapshot(old);
  expect(
    migrated.graph.nodes.find((item) => item.id === 'phone-placeholder')?.position,
  ).not.toEqual(migrated.graph.nodes.find((item) => item.id === 'web-media')?.position);
  expect(validateSnapshot(migrated)).toEqual(migrated);
});

it('未接続アプリはLINEと同じ高さ、電話の確認事項は複数メディアラインの下へ置く', () => {
  const mediaLines = Array.from({ length: 6 }, (_, index) => ({
    id: `line-${index}`,
    name: `メディアライン${index + 1}`,
    isDirect: true,
  }));
  const snapshot = generateSnapshot(
    { ...answers, measurements: ['web', 'app', 'phone', 'line'] },
    mediaLines,
  );
  const app = snapshot.graph.nodes.find((item) => item.id === 'app-placeholder')!;
  const line = snapshot.graph.nodes.find((item) => item.id === 'line-friend-add')!;
  const phone = snapshot.graph.nodes.find((item) => item.id === 'phone-placeholder')!;
  expect(app.position.y).toBe(line.position.y);
  expect(app.position.x).toBeLessThan(line.position.x);
  expect(phone.position.y).toBeGreaterThan(
    Math.max(
      ...snapshot.graph.nodes
        .filter((item) => item.role === 'media')
        .map((item) => item.position.y),
    ),
  );
  expect(validateSnapshot(snapshot)).toEqual(snapshot);
});
