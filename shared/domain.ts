import type {
  Answers,
  FlowEdge,
  FlowNode,
  LegacySnapshot,
  MediaLine,
  Measurement,
  Graph,
  ReadableSnapshot,
  LegacyV2Snapshot,
  Snapshot,
  TagConfig,
} from './types';
import { validateSnapshot as validateV1 } from './legacy-domain';
import {
  validateSnapshot as validateV2,
  generateSnapshot as generateV2,
  normalizeSnapshot as normalizeV2,
} from './legacy-v2-domain';
import { measurementLabels } from './types';

const measurements: Measurement[] = ['web', 'app', 'phone', 'line'];
const editableNodeFields = ['title', 'system', 'url', 'note', 'position'] as const;
const clone = <T>(value: T): T => structuredClone(value);

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function record(value: unknown, name: string): asserts value is Record<string, unknown> {
  check(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${name}の形式が不正です。`,
  );
}
function text(value: unknown, name: string, max = 10000): asserts value is string {
  check(
    typeof value === 'string' && value.length <= max,
    `${name}は${max}文字以内の文字列にしてください。`,
  );
}
function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): asserts value is T {
  check(typeof value === 'string' && allowed.includes(value as T), `${name}の値が不正です。`);
}

export function validateAnswers(value: unknown): Answers {
  record(value, '回答');
  check(
    Object.keys(value).every((key) => ['postback', 'measurements'].includes(key)),
    '案件の回答に入稿経路は設定できません。メディアラインごとに設定してください。',
  );
  check(typeof value.postback === 'boolean', 'CV受信方式の回答が不正です。');
  check(
    Array.isArray(value.measurements) &&
      value.measurements.length > 0 &&
      value.measurements.length <= 4,
    '計測種別を1つ以上選択してください。',
  );
  value.measurements.forEach((item) => oneOf(item, measurements, '計測種別'));
  check(
    new Set(value.measurements).size === value.measurements.length,
    '計測種別が重複しています。',
  );
  return {
    postback: value.postback,
    measurements: measurements.filter((m) => (value.measurements as unknown[]).includes(m)),
  };
}

export const defaultMediaLines = (): MediaLine[] => [
  { id: 'default', name: 'メディアライン1', isDirect: true },
];
export function validateMediaLines(value: unknown): MediaLine[] {
  check(
    Array.isArray(value) && value.length > 0 && value.length <= 50,
    'メディアラインを1〜50件設定してください。',
  );
  const ids = new Set<string>();
  return value.map((item) => {
    record(item, 'メディアライン');
    check(
      Object.keys(item).every((key) => ['id', 'name', 'isDirect'].includes(key)),
      'メディアラインの項目が不正です。',
    );
    text(item.id, 'メディアラインID', 80);
    check(/^[A-Za-z0-9_-]+$/.test(item.id), 'メディアラインIDの形式が不正です。');
    check(!ids.has(item.id), 'メディアラインIDが重複しています。');
    ids.add(item.id);
    // 旧v1ノード名の保存上限を維持し、長い既存名を移行時に拒否・切り詰めない。
    text(item.name, 'メディアライン名', 10000);
    check(item.name.trim().length > 0, 'メディアライン名を入力してください。');
    check(typeof item.isDirect === 'boolean', 'メディアラインの入稿経路が不正です。');
    return { id: item.id, name: item.name, isDirect: item.isDirect };
  });
}

function branchNode(
  id: string,
  role: string,
  title: string,
  measurement: Measurement,
  x: number,
  y: number,
  note: string,
  system = '',
): FlowNode {
  return { id, role, title, measurement, system, url: '', note, position: { x, y }, manual: [] };
}
function connection(
  id: string,
  source: string,
  target: string,
  kind: FlowEdge['kind'],
  label: string,
  identifier = '',
): FlowEdge {
  return { id, source, target, kind, label, identifier };
}

function generateGraph(answers: Answers, lines: MediaLine[]): Graph {
  const base = generateV2({ postback: answers.postback, measurements: ['web'] }, lines).routes[0];
  const hasWeb = answers.measurements.includes('web');
  const hasPhone = answers.measurements.includes('phone');
  const hasLine = answers.measurements.includes('line');
  const hasLP = hasWeb || hasPhone || hasLine;
  const nodes = base.nodes
    .filter((item) => {
      if (['thanks', 'cl'].includes(item.role)) return hasWeb;
      if (item.role === 'alladin') return hasWeb || hasPhone;
      if (item.role === 'lp') return hasLP;
      return true;
    })
    .map((item) => ({
      ...item,
      ...(['thanks', 'cl'].includes(item.role) ? { measurement: 'web' as const } : {}),
    }));
  const ids = new Set(nodes.map((item) => item.id));
  const edges = base.edges.filter((item) => ids.has(item.source) && ids.has(item.target));
  const lpX = nodes.find((item) => item.role === 'lp')?.position.x ?? 500;
  if (hasLine) {
    nodes.push(
      branchNode(
        'line-friend-add',
        'line-friend-add',
        'LINE友だち追加',
        'line',
        lpX + 320,
        600,
        'LPから友だち追加画面へ。成果通知先・完了条件・識別子は要確認。',
        'LINE',
      ),
    );
    edges.push(
      connection(
        'line-lp-friend-add',
        'web-lp',
        'line-friend-add',
        'navigation',
        '友だち追加画面へ',
      ),
    );
  }
  if (hasPhone) {
    const note =
      '参考構成・要確認：PDFの電話計測例。実案件の番号管理・CV成立条件・取得方式を確認してください。';
    nodes.push(
      branchNode(
        'phone-call-data-bank',
        'call-data-bank',
        'Call Data Bank',
        'phone',
        lpX + 300,
        860,
        note,
        'Call Data Bank',
      ),
      branchNode(
        'phone-call-tracker',
        'call-tracker',
        'Call Tracker',
        'phone',
        lpX + 600,
        860,
        '電話接続・通話開始検知の設定を確認',
        'Call Tracker',
      ),
      branchNode(
        'phone-call-center',
        'call-center',
        'コールセンター',
        'phone',
        lpX + 900,
        860,
        '実際の接続先番号は要確認',
        'コールセンター',
      ),
      branchNode(
        'phone-records',
        'phone-records',
        'Call Data Bankの通話記録',
        'phone',
        lpX + 300,
        1160,
        'LPのCall Data Bankタグで表示番号とLP URL（affnmsid）を対応付ける参考例。実際の保存項目は要確認。',
        'Call Data Bank',
      ),
      branchNode(
        'phone-tracker-records',
        'tracker-records',
        'Call Trackerの通話記録',
        'phone',
        lpX + 600,
        1160,
        '通話開始の記録。CV成立条件やALLADiNへの連携方法は要確認。',
        'Call Tracker',
      ),
      branchNode(
        'phone-batch',
        'phone-batch',
        'ALLADiN データ取得バッチ',
        'phone',
        lpX,
        1160,
        'Call Data Bank APIから架電データを取得する参考例。取得間隔・認証・成果判定は未設定。',
        'ALLADiN',
      ),
      branchNode(
        'phone-placeholder',
        'phone_note',
        '電話計測の確認事項',
        'phone',
        0,
        Math.max(1160, 120 + (lines.length - 1) * 240 + 240),
        note,
      ),
    );
    edges.push(
      connection(
        'phone-lp-call-data-bank',
        'web-lp',
        'phone-call-data-bank',
        'phone',
        '表示番号へ発信',
      ),
      connection(
        'phone-data-bank-tracker',
        'phone-call-data-bank',
        'phone-call-tracker',
        'phone',
        '計測番号へ接続',
      ),
      connection(
        'phone-tracker-center',
        'phone-call-tracker',
        'phone-call-center',
        'phone',
        'コールセンターへ接続',
      ),
      connection(
        'phone-data-bank-records',
        'phone-call-data-bank',
        'phone-records',
        'notification',
        '通話開始検知',
      ),
      connection(
        'phone-tracker-records',
        'phone-call-tracker',
        'phone-tracker-records',
        'notification',
        '通話開始検知',
      ),
      connection(
        'phone-lp-records',
        'web-lp',
        'phone-records',
        'notification',
        '表示番号・LP URLを対応付け',
        'affnmsid',
      ),
      connection(
        'phone-records-batch',
        'phone-records',
        'phone-batch',
        'notification',
        'Call Data Bank API・架電データ取得',
      ),
      connection(
        'phone-batch-alladin',
        'phone-batch',
        'web-alladin',
        'notification',
        '成果連携（成立条件要確認）',
        'affnmsid',
      ),
    );
  }
  if (answers.measurements.includes('app')) {
    nodes.push(
      branchNode(
        'app-placeholder',
        'placeholder',
        'アプリ計測：接続先を確認',
        'app',
        lpX,
        600,
        'アプリ内イベント、計測ツール、識別子、CV通知先・接続先を確認してください。LINE友だち追加とは別の計測です。',
      ),
    );
  }
  return {
    id: 'main',
    templateVersion: 3,
    nodes,
    edges,
    status: answers.measurements.some((item) => item !== 'web') ? 'unresolved' : 'defined',
    note: '',
  };
}

function syncTagEdges(snapshot: Snapshot) {
  const graph = snapshot.graph;
  const thanks = graph.nodes.find((item) => item.id === 'web-thanks');
  graph.edges = graph.edges.filter(
    (item) => item.id !== 'web-thanks-alladin' && item.id !== 'web-thanks-cl-cvtag',
  );
  if (thanks?.tag?.usage !== 'enabled') return;
  const destination = thanks.tag.destination.trim().toLowerCase();
  if (destination === 'alladin') {
    graph.edges.push(
      connection(
        'web-thanks-alladin',
        'web-thanks',
        'web-alladin',
        'notification',
        'CVタグによる通知',
      ),
    );
    return;
  }
  const cl = graph.nodes.find((item) => item.id === 'web-cl');
  if (
    cl &&
    destination &&
    [cl.title, cl.system, 'CL'].some((item) => item.toLowerCase() === destination)
  ) {
    graph.edges.push(
      connection(
        'web-thanks-cl-cvtag',
        'web-thanks',
        'web-cl',
        'notification',
        `CVタグ（${thanks.tag.destination}）`,
      ),
    );
  }
}

export function generateSnapshot(
  input: Answers,
  inputLines: MediaLine[] = defaultMediaLines(),
): Snapshot {
  const answers = validateAnswers(input);
  const mediaLines = validateMediaLines(inputLines);
  const snapshot: Snapshot = {
    answers,
    mediaLines,
    graph: generateGraph(answers, mediaLines),
    schemaVersion: 3,
    generatorVersion: 3,
  };
  syncTagEdges(snapshot);
  return snapshot;
}
function nodeSummary(node: FlowNode): string {
  const values = (node.manual ?? []).map((field) =>
    field === 'position'
      ? `位置 (${node.position.x}, ${node.position.y})`
      : `${field}: ${String(node[field as keyof FlowNode])}`,
  );
  if (node.tag?.source === 'manual')
    values.push(
      `タグ設定: ${node.tag.usage}、送信先 ${node.tag.destination || '未設定'}、役割 ${node.tag.role || '未設定'}、発火条件 ${node.tag.condition || '未設定'}`,
    );
  return `${node.title}：${values.join(' / ')}`;
}
export function regenerateSnapshot(
  previous: Snapshot,
  answers: Answers,
  mediaLines: MediaLine[] = previous.mediaLines,
): { snapshot: Snapshot; removed: string[] } {
  const snapshot = generateSnapshot(answers, mediaLines);
  const removed: string[] = [];
  for (const old of previous.graph.nodes) {
    const target = snapshot.graph.nodes.find((item) => item.id === old.id);
    if (!target) {
      if (old.manual?.length || old.tag?.source === 'manual') removed.push(nodeSummary(old));
      continue;
    }
    target.manual = clone(old.manual ?? []);
    for (const field of editableNodeFields) {
      if (old.manual?.includes(field) && !(target.role === 'media' && field === 'title'))
        Object.assign(target, { [field]: clone(old[field]) });
    }
    if (old.tag?.source === 'manual' && target.tag) target.tag = clone(old.tag);
  }
  snapshot.graph.note = previous.graph.note;
  syncTagEdges(snapshot);
  for (const old of previous.graph.edges) {
    const target = snapshot.graph.edges.find((item) => item.id === old.id);
    if (!target) {
      if (old.manual) removed.push(`接続 ${old.label}：識別子 ${old.identifier || 'なし'}`);
    } else if (old.manual)
      Object.assign(target, { label: old.label, identifier: old.identifier, manual: true });
  }
  return { snapshot, removed };
}
function validateTag(value: unknown, name: string) {
  record(value, name);
  oneOf(value.usage, ['enabled', 'disabled', 'undecided'], `${name}の使用有無`);
  oneOf(value.source, ['default', 'manual'], `${name}の設定値の由来`);
  for (const key of ['destination', 'role', 'condition']) text(value[key], `${name}.${key}`);
}
export function validateSnapshot(value: unknown): Snapshot {
  record(value, '導線');
  check(
    value.schemaVersion === 3 && value.generatorVersion === 3,
    '対応していない導線データのバージョンです。',
  );
  check(!('routes' in value), '計測種別ごとの別図は保存できません。共通グラフを使用してください。');
  const answers = validateAnswers(value.answers);
  const mediaLines = validateMediaLines(value.mediaLines);
  record(value.graph, '共通グラフ');
  const graph = value.graph;
  check(graph.id === 'main' && graph.templateVersion === 3, '共通グラフの形式が不正です。');
  text(graph.note, '図の注記', 40000);
  const expected = generateSnapshot(answers, mediaLines);
  check(graph.status === expected.graph.status, '導線の定義状態が不正です。');
  check(
    Array.isArray(graph.nodes) && graph.nodes.length === expected.graph.nodes.length,
    '回答とノード構成が一致しません。',
  );
  const nodeIds = new Set<string>();
  for (const item of graph.nodes) {
    record(item, 'ノード');
    text(item.id, 'ノードID', 200);
    check(!nodeIds.has(item.id), 'ノードIDが重複しています。');
    nodeIds.add(item.id);
    const expectedNode = expected.graph.nodes.find((node) => node.id === item.id);
    check(expectedNode && expectedNode.role === item.role, '回答とノードの役割が一致しません。');
    check(expectedNode.mediaLineId === item.mediaLineId, 'ノードのメディアラインが一致しません。');
    check(expectedNode.measurement === item.measurement, 'ノードの計測種別が一致しません。');
    for (const key of ['title', 'system', 'url', 'note'])
      text(item[key], `ノード.${key}`, key === 'note' ? 40000 : 10000);
    check((item.title as string).trim().length > 0, 'ノード名は空にできません。');
    if (item.role === 'media')
      check(item.title === expectedNode.title, 'メディアライン名とノード名が一致しません。');
    record(item.position, 'ノード位置');
    check(
      typeof item.position.x === 'number' &&
        Number.isFinite(item.position.x) &&
        typeof item.position.y === 'number' &&
        Number.isFinite(item.position.y),
      'ノード位置は有限の数値にしてください。',
    );
    if (item.manual !== undefined) {
      check(
        Array.isArray(item.manual) && new Set(item.manual).size === item.manual.length,
        'ノードの手動編集情報が不正です。',
      );
      item.manual.forEach((field) => oneOf(field, editableNodeFields, '手動編集対象'));
    }
    check(Boolean(expectedNode.tag) === Boolean(item.tag), 'ページのタグ構成が不正です。');
    if (item.tag !== undefined) {
      validateTag(item.tag, 'タグ');
      expectedNode.tag = clone(item.tag) as TagConfig;
    }
    expectedNode.title = item.title as string;
    expectedNode.system = item.system as string;
  }
  syncTagEdges(expected);
  check(
    Array.isArray(graph.edges) && graph.edges.length === expected.graph.edges.length,
    '回答と接続構成が一致しません。',
  );
  const edgeIds = new Set<string>();
  for (const item of graph.edges) {
    record(item, '接続');
    text(item.id, '接続ID', 200);
    check(!edgeIds.has(item.id), '接続IDが重複しています。');
    edgeIds.add(item.id);
    text(item.source, '接続元', 200);
    text(item.target, '接続先', 200);
    check(nodeIds.has(item.source) && nodeIds.has(item.target), '接続先のノードが存在しません。');
    oneOf(item.kind, ['navigation', 'notification', 'phone'], '接続の種類');
    const expectedEdge = expected.graph.edges.find((edge) => edge.id === item.id);
    check(
      expectedEdge &&
        expectedEdge.source === item.source &&
        expectedEdge.target === item.target &&
        expectedEdge.kind === item.kind,
      '回答と接続の構造が一致しません。',
    );
    text(item.label, '接続ラベル');
    text(item.identifier, '識別子');
    check(
      item.manual === undefined || typeof item.manual === 'boolean',
      '接続の手動編集情報が不正です。',
    );
  }
  return clone(value) as unknown as Snapshot;
}

export function validateLegacySnapshot(value: unknown): LegacySnapshot {
  return validateV1(value);
}
export function validateLegacyV2Snapshot(value: unknown): LegacyV2Snapshot {
  return validateV2(value);
}
export function getMediaLines(snapshot: ReadableSnapshot): MediaLine[] {
  if (snapshot.schemaVersion !== 1) return clone(snapshot.mediaLines);
  return clone(normalizeV2(snapshot).mediaLines);
}
/** Compose a display copy of historical routes, never regenerating saved topology. */
export function getCanvasGraph(snapshot: ReadableSnapshot): Graph {
  if (snapshot.schemaVersion === 3) return clone(snapshot.graph);
  const valid = snapshot.schemaVersion === 1 ? validateV1(snapshot) : validateV2(snapshot);
  const graph: Graph = {
    id: 'main',
    templateVersion: 3,
    nodes: [],
    edges: [],
    status: valid.routes.some((route) => route.status === 'unresolved') ? 'unresolved' : 'defined',
    note: valid.routes
      .map((route) => route.note)
      .filter(Boolean)
      .join('\n'),
  };
  let bottom = 0;
  const ids = new Set<string>();
  const edgeIds = new Set<string>();
  for (const route of valid.routes) {
    const minY = Math.min(...route.nodes.map((node) => node.position.y));
    const offset = graph.nodes.length ? bottom + 300 - minY : 0;
    for (const source of route.nodes) {
      check(!ids.has(source.id), '保存版のノードIDが重複しています。');
      ids.add(source.id);
      const item = clone(source);
      item.position.y += offset;
      if (source.role === 'media' && source.title === '媒体') item.title = 'メディアライン1';
      if (source.system === '媒体') item.system = 'メディアライン';
      if (route.measurement !== 'web' || ['thanks', 'cl'].includes(source.role))
        item.measurement = route.measurement;
      graph.nodes.push(item);
    }
    for (const edge of route.edges) {
      check(!edgeIds.has(edge.id), '保存版の接続IDが重複しています。');
      edgeIds.add(edge.id);
      graph.edges.push(clone(edge));
    }
    bottom = Math.max(...graph.nodes.map((node) => node.position.y));
  }
  return graph;
}

/** Only editable copies gain the new reference branches; historical JSON remains unchanged. */
export function normalizeSnapshot(value: unknown): Snapshot {
  record(value, '導線');
  if (value.schemaVersion === 3) return validateSnapshot(value);
  const legacy = value.schemaVersion === 1 ? normalizeV2(value) : validateV2(value);
  const snapshot = generateSnapshot(legacy.answers, legacy.mediaLines);
  const oldGraph = getCanvasGraph(legacy);
  snapshot.graph.note = oldGraph.note;
  for (const old of oldGraph.nodes) {
    const item = snapshot.graph.nodes.find((node) => node.id === old.id);
    check(item, '旧ノードの移行先がありません。');
    const role = item.role,
      measurement = item.measurement,
      mediaLineId = item.mediaLineId;
    const isDefaultPlaceholder = old.role === 'placeholder' && !old.manual?.includes('title');
    const defaultTitle = item.title;
    const defaultPosition = clone(item.position);
    Object.assign(item, clone(old), { role, measurement, mediaLineId });
    if (isDefaultPlaceholder) item.title = defaultTitle;
    // 旧単独タブの初期位置を共通図へ持ち込むと、共通LPや入口と重なる。
    // 利用者が動かした位置だけは合成表示上の座標として保持する。
    if (old.role === 'placeholder' && !old.manual?.includes('position'))
      item.position = defaultPosition;
    // 旧ルート単位のメモも対応する確認事項ノードに残す。
    const oldRoute = legacy.routes.find((route) => route.nodes.some((node) => node.id === old.id));
    if (old.role === 'placeholder' && oldRoute?.note && !item.note.includes(oldRoute.note))
      item.note = `${item.note}\n${oldRoute.note}`;
    if (old.role === 'placeholder' && oldRoute?.note)
      item.manual = [...new Set([...(item.manual ?? []), 'note'])];
  }
  syncTagEdges(snapshot);
  for (const old of oldGraph.edges) {
    const item = snapshot.graph.edges.find((edge) => edge.id === old.id);
    check(item, '旧接続の移行先がありません。');
    Object.assign(item, clone(old));
  }
  return validateSnapshot(snapshot);
}

export function getIssues(snapshot: ReadableSnapshot): string[] {
  const graph = snapshot.schemaVersion === 3 ? snapshot.graph : getCanvasGraph(snapshot);
  const issues: string[] = [];
  const thanks = graph.nodes.find((item) => item.id === 'web-thanks');
  if (snapshot.answers.measurements.includes('app'))
    issues.push(
      'アプリ計測の接続先・計測ツール・CV通知先は未確定です。LINE友だち追加とは別に確認してください。',
    );
  if (snapshot.answers.measurements.includes('phone'))
    issues.push(
      '電話計測はPDFを参考にした構成です。番号管理・CV成立条件・API取得方式を確認してください。',
    );
  if (snapshot.answers.measurements.includes('line'))
    issues.push(
      'LINE友だち追加の完了条件・識別子・成果通知先を確認してください。アプリ計測とは別の経路です。',
    );
  if (
    snapshot.answers.measurements.includes('web') &&
    !snapshot.answers.postback &&
    thanks?.tag?.usage === 'disabled'
  )
    issues.push('Web計測のCVタグが無効です。ALLADiNへのCV通知経路を確認してください。');
  for (const node of graph.nodes) {
    const label = node.measurement ? measurementLabels[node.measurement] : '共通導線';
    if (['media', 'aa', 'lp', 'thanks', 'line-friend-add'].includes(node.role) && !node.url.trim())
      issues.push(`${label}・${node.title}のURLが未入力です。`);
    if (node.url.trim()) {
      try {
        const url = new URL(node.url);
        if (!['http:', 'https:'].includes(url.protocol))
          issues.push(`${label}・${node.title}のURLはhttpまたはhttpsで指定してください。`);
      } catch {
        issues.push(`${label}・${node.title}のURL形式を確認してください。`);
      }
    }
    if (node.tag?.usage === 'undecided')
      issues.push(`${label}・${node.title}のタグ使用有無が未定です。`);
    if (node.tag?.usage === 'enabled') {
      if (!node.tag.destination.trim())
        issues.push(`${label}・${node.title}のタグ送信先が未入力です。`);
      if (!node.tag.role.trim()) issues.push(`${label}・${node.title}のタグの役割が未入力です。`);
    }
    if (
      node.id === 'web-thanks' &&
      node.tag?.usage === 'enabled' &&
      node.tag.destination.trim() &&
      !graph.edges.some(
        (edge) =>
          edge.source === node.id &&
          ['web-thanks-alladin', 'web-thanks-cl-cvtag'].includes(edge.id),
      )
    )
      issues.push(
        `${label}・${node.title}のCVタグ送信先「${node.tag.destination}」に対応する計測経路を確認してください。`,
      );
    if (snapshot.answers.postback && node.id === 'web-thanks' && node.tag?.usage === 'enabled')
      issues.push(
        'CLポストバックとCVタグを併用します。送信先・役割と二重計測の有無を確認してください。',
      );
  }
  return issues;
}
