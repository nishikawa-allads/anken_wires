// 旧v1保存版の検証専用。ルールを新仕様へ置き換えず保持する。
import type {
  LegacyAnswers as Answers,
  FlowEdge,
  FlowNode,
  Measurement,
  Route,
  LegacySnapshot as Snapshot,
  TagConfig,
} from './types';
import { measurementLabels } from './types';

const measurements: Exclude<Measurement, 'line'>[] = ['web', 'app', 'phone'];
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
    typeof value.isDirect === 'boolean' && typeof value.postback === 'boolean',
    '媒体・CV受信方式の回答が不正です。',
  );
  check(
    Array.isArray(value.measurements) &&
      value.measurements.length > 0 &&
      value.measurements.length <= 3,
    '計測種別を1つ以上選択してください。',
  );
  value.measurements.forEach((item) => oneOf(item, measurements, '計測種別'));
  check(
    new Set(value.measurements).size === value.measurements.length,
    '計測種別が重複しています。',
  );
  return {
    isDirect: value.isDirect,
    postback: value.postback,
    measurements: measurements.filter((m) => (value.measurements as unknown[]).includes(m)),
  };
}

function tag(usage: TagConfig['usage'], destination: string, role: string): TagConfig {
  return { usage, source: 'default', destination, role, condition: '' };
}
function node(role: string, title: string, x: number, y = 120, system = ''): FlowNode {
  return {
    id: `web-${role}`,
    role,
    title,
    system,
    url: '',
    note: '',
    position: { x, y },
    manual: [],
  };
}
function edge(
  source: string,
  target: string,
  kind: FlowEdge['kind'],
  label: string,
  identifier = '',
): FlowEdge {
  return {
    id: `web-${source}-${target}`,
    source: `web-${source}`,
    target: `web-${target}`,
    kind,
    label,
    identifier,
  };
}

function webRoute(answers: Answers): Route {
  let x = 0;
  const media = node('media', '媒体', x, 120, '媒体');
  media.note = answers.isDirect ? 'AA入稿URLを設定' : 'ASP入稿URLを設定';
  const nodes: FlowNode[] = [media];
  const edges: FlowEdge[] = [];
  if (!answers.isDirect) {
    x += 250;
    nodes.push(node('aa', 'AA入稿URL', x, 120, 'ALLADiN'));
    edges.push(edge('media', 'aa', 'navigation', 'リダイレクト'));
  }
  x += 250;
  const lp = node('lp', 'LP', x);
  lp.tag = tag('enabled', '', 'LP計測');
  nodes.push(lp);
  edges.push(edge(answers.isDirect ? 'media' : 'aa', 'lp', 'navigation', 'LPへ遷移', 'affnmsid'));
  x += 250;
  const thanks = node('thanks', 'サンクス', x);
  thanks.tag = tag(
    answers.postback ? 'disabled' : 'enabled',
    answers.postback ? '' : 'ALLADiN',
    'CV計測',
  );
  nodes.push(thanks);
  edges.push(edge('lp', 'thanks', 'navigation', '完了ページへ'));
  if (answers.postback) {
    x += 250;
    const cl = node('cl', 'CLの計測ツール', x, 360, 'CLの計測ツール');
    cl.note = 'CL側でCV発生。計測方法・成立条件を確認';
    nodes.push(cl);
    edges.push(edge('thanks', 'cl', 'notification', 'CL側でCV計測'));
  }
  x += 250;
  const alladin = node('alladin', 'ALLADiN', x, 360, 'ALLADiN');
  alladin.note = 'CV発生';
  nodes.push(alladin);
  edges.push(
    edge(
      answers.postback ? 'cl' : 'thanks',
      'alladin',
      'notification',
      answers.postback ? 'ポストバック' : 'CVタグによる通知',
    ),
  );
  return {
    id: 'web',
    measurement: 'web',
    templateVersion: 1,
    nodes,
    edges,
    status: 'defined',
    note: '',
  };
}

function unresolvedRoute(measurement: 'app' | 'phone'): Route {
  const note =
    measurement === 'app'
      ? 'アプリ内イベント、計測ツール、識別子、CV通知先を確認してください。'
      : '電話CVの成立条件、番号管理、計測ツール、通知内容を確認してください。参考画像の構成は全案件共通ではありません。';
  return {
    id: measurement,
    measurement,
    templateVersion: 1,
    status: 'unresolved',
    note,
    nodes: [
      {
        id: `${measurement}-placeholder`,
        role: 'placeholder',
        title: `${measurementLabels[measurement]}：テンプレート未定`,
        system: '',
        url: '',
        note,
        position: { x: 0, y: 120 },
        manual: [],
      },
    ],
    edges: [],
  };
}

/** Derive notifications from tag settings without inventing a destination. */
function syncTagEdges(snapshot: Snapshot): void {
  const route = snapshot.routes.find((item) => item.measurement === 'web');
  if (!route) return;
  const thanks = route.nodes.find((item) => item.role === 'thanks');
  if (!thanks?.tag) return;
  route.edges = route.edges.filter(
    (item) => item.id !== 'web-thanks-alladin' && item.id !== 'web-thanks-cl-cvtag',
  );
  if (thanks.tag.usage !== 'enabled') return;
  const destination = thanks.tag.destination.trim().toLowerCase();
  if (destination === 'alladin') {
    route.edges.push(edge('thanks', 'alladin', 'notification', 'CVタグによる通知'));
    return;
  }
  const cl = route.nodes.find((item) => item.role === 'cl');
  if (
    cl &&
    destination &&
    [cl.title, cl.system, 'CL'].some((item) => item.toLowerCase() === destination)
  ) {
    route.edges.push({
      ...edge('thanks', 'cl', 'notification', `CVタグ（${thanks.tag.destination}）`),
      id: 'web-thanks-cl-cvtag',
    });
  }
}

export function generateSnapshot(input: Answers): Snapshot {
  const answers = validateAnswers(input);
  const snapshot: Snapshot = {
    answers,
    routes: answers.measurements.map((measurement) => {
      if (measurement === 'web') return webRoute(answers);
      if (measurement === 'app' || measurement === 'phone') return unresolvedRoute(measurement);
      throw new Error('旧形式では対応していない計測種別です。');
    }),
    schemaVersion: 1,
    generatorVersion: 1,
  };
  syncTagEdges(snapshot);
  return snapshot;
}

function hasManualNode(node: FlowNode): boolean {
  return Boolean(node.manual?.length || node.tag?.source === 'manual');
}
function nodeSummary(node: FlowNode): string {
  const values = (node.manual ?? []).map((field) => {
    if (field === 'position') return `位置 (${node.position.x}, ${node.position.y})`;
    return `${field}: ${String(node[field as keyof FlowNode])}`;
  });
  if (node.tag?.source === 'manual')
    values.push(
      `タグ設定: ${node.tag.usage}、送信先 ${node.tag.destination || '未設定'}、役割 ${node.tag.role || '未設定'}、発火条件 ${node.tag.condition || '未設定'}`,
    );
  return `${node.title}：${values.join(' / ')}`;
}

export function regenerateSnapshot(
  previous: Snapshot,
  answers: Answers,
): { snapshot: Snapshot; removed: string[] } {
  const snapshot = generateSnapshot(answers);
  const removed: string[] = [];
  for (const oldRoute of previous.routes) {
    const newRoute = snapshot.routes.find((item) => item.id === oldRoute.id);
    if (!newRoute && oldRoute.note)
      removed.push(`${measurementLabels[oldRoute.measurement]}：${oldRoute.note}`);
    for (const oldNode of oldRoute.nodes) {
      const newNode = newRoute?.nodes.find((item) => item.id === oldNode.id);
      if (!newNode) {
        if (hasManualNode(oldNode)) removed.push(nodeSummary(oldNode));
        continue;
      }
      newNode.manual = clone(oldNode.manual ?? []);
      for (const field of editableNodeFields) {
        if (oldNode.manual?.includes(field))
          Object.assign(newNode, { [field]: clone(oldNode[field]) });
      }
      if (oldNode.tag?.source === 'manual' && newNode.tag) newNode.tag = clone(oldNode.tag);
    }
    if (newRoute) newRoute.note = oldRoute.note;
  }
  syncTagEdges(snapshot);
  for (const oldRoute of previous.routes) {
    const newRoute = snapshot.routes.find((item) => item.id === oldRoute.id);
    for (const oldEdge of oldRoute.edges) {
      const newEdge = newRoute?.edges.find((item) => item.id === oldEdge.id);
      if (!newEdge) {
        if (oldEdge.manual)
          removed.push(`接続 ${oldEdge.label}：識別子 ${oldEdge.identifier || 'なし'}`);
      } else if (oldEdge.manual) {
        newEdge.label = oldEdge.label;
        newEdge.identifier = oldEdge.identifier;
        newEdge.manual = true;
      }
    }
  }
  return { snapshot, removed };
}

function validateTag(value: unknown, name: string): void {
  record(value, name);
  oneOf(value.usage, ['enabled', 'disabled', 'undecided'], `${name}の使用有無`);
  oneOf(value.source, ['default', 'manual'], `${name}の設定値の由来`);
  for (const key of ['destination', 'role', 'condition']) text(value[key], `${name}.${key}`);
}

export function validateSnapshot(value: unknown): Snapshot {
  record(value, '導線');
  check(
    value.schemaVersion === 1 && value.generatorVersion === 1,
    '対応していない導線データのバージョンです。',
  );
  const answers = validateAnswers(value.answers);
  check(
    Array.isArray(value.routes) && value.routes.length === answers.measurements.length,
    '回答と導線数が一致しません。',
  );
  const expected = generateSnapshot(answers);
  const routeIds = new Set<string>();
  for (const route of value.routes) {
    record(route, '計測導線');
    text(route.id, '導線ID', 200);
    oneOf(route.measurement, measurements, '計測種別');
    check(!routeIds.has(route.id), '導線IDが重複しています。');
    routeIds.add(route.id);
    check(
      route.id === route.measurement && answers.measurements.includes(route.measurement),
      '回答と導線の計測種別が一致しません。',
    );
    check(route.templateVersion === 1, '対応していないテンプレートのバージョンです。');
    const expectedRoute = expected.routes.find((item) => item.id === route.id)!;
    check(route.status === expectedRoute.status, '導線の定義状態が不正です。');
    text(route.note, '導線の注記');
    check(
      Array.isArray(route.nodes) && route.nodes.length === expectedRoute.nodes.length,
      '回答とノード構成が一致しません。',
    );
    const nodeIds = new Set<string>();
    for (const item of route.nodes) {
      record(item, 'ノード');
      text(item.id, 'ノードID', 200);
      text(item.role, 'ノードの役割', 100);
      check(!nodeIds.has(item.id), 'ノードIDが重複しています。');
      nodeIds.add(item.id);
      const expectedNode = expectedRoute.nodes.find((n) => n.id === item.id);
      check(expectedNode && expectedNode.role === item.role, '回答とノードの役割が一致しません。');
      for (const key of ['title', 'system', 'url', 'note']) text(item[key], `ノード.${key}`);
      check((item.title as string).trim().length > 0, 'ノード名は空にできません。');
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
      if (item.tag !== undefined) validateTag(item.tag, 'タグ');
    }
    for (const expectedNode of expectedRoute.nodes) {
      const actual = route.nodes.find(
        (item: Record<string, unknown>) => item.id === expectedNode.id,
      ) as Record<string, unknown>;
      if (actual.tag) expectedNode.tag = clone(actual.tag) as TagConfig;
      expectedNode.title = actual.title as string;
      expectedNode.system = actual.system as string;
    }
    syncTagEdges(expected);
    check(
      Array.isArray(route.edges) && route.edges.length === expectedRoute.edges.length,
      '回答と接続構成が一致しません。',
    );
    const edgeIds = new Set<string>();
    for (const item of route.edges) {
      record(item, '接続');
      text(item.id, '接続ID', 200);
      check(!edgeIds.has(item.id), '接続IDが重複しています。');
      edgeIds.add(item.id);
      text(item.source, '接続元', 200);
      text(item.target, '接続先', 200);
      check(nodeIds.has(item.source) && nodeIds.has(item.target), '接続先のノードが存在しません。');
      oneOf(item.kind, ['navigation', 'notification', 'phone'], '接続の種類');
      const expectedEdge = expectedRoute.edges.find((e) => e.id === item.id);
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
  }
  return clone(value) as unknown as Snapshot;
}

function needsUrl(node: FlowNode): boolean {
  return ['media', 'aa', 'lp', 'thanks'].includes(node.role);
}

export function getIssues(snapshot: Snapshot): string[] {
  const issues: string[] = [];
  for (const route of snapshot.routes) {
    const label = measurementLabels[route.measurement];
    if (route.status === 'unresolved') issues.push(`${label}の導線は未確定です。${route.note}`);
    const thanks = route.nodes.find((item) => item.role === 'thanks');
    if (
      route.measurement === 'web' &&
      !snapshot.answers.postback &&
      thanks?.tag?.usage === 'disabled'
    ) {
      issues.push('Web計測のCVタグが無効です。ALLADiNへのCV通知経路を確認してください。');
    }
    for (const item of route.nodes) {
      if (needsUrl(item) && !item.url.trim())
        issues.push(`${label}・${item.title}のURLが未入力です。`);
      if (item.url.trim()) {
        try {
          const url = new URL(item.url);
          if (!['http:', 'https:'].includes(url.protocol))
            issues.push(`${label}・${item.title}のURLはhttpまたはhttpsで指定してください。`);
        } catch {
          issues.push(`${label}・${item.title}のURL形式を確認してください。`);
        }
      }
      if (item.tag?.usage === 'undecided')
        issues.push(`${label}・${item.title}のタグ使用有無が未定です。`);
      if (item.tag?.usage === 'enabled') {
        if (!item.tag.destination.trim())
          issues.push(`${label}・${item.title}のタグ送信先が未入力です。`);
        if (!item.tag.role.trim()) issues.push(`${label}・${item.title}のタグの役割が未入力です。`);
      }
      if (
        item.role === 'thanks' &&
        item.tag?.usage === 'enabled' &&
        item.tag.destination.trim() &&
        !route.edges.some(
          (edge) =>
            edge.source === item.id &&
            (edge.id === 'web-thanks-alladin' || edge.id === 'web-thanks-cl-cvtag'),
        )
      ) {
        issues.push(
          `${label}・${item.title}のCVタグ送信先「${item.tag.destination}」に対応する計測経路を確認してください。`,
        );
      }
      if (snapshot.answers.postback && item.role === 'thanks' && item.tag?.usage === 'enabled') {
        issues.push(
          'CLポストバックとCVタグを併用します。送信先・役割と二重計測の有無を確認してください。',
        );
      }
    }
  }
  return issues;
}
