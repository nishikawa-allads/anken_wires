import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  FileClock,
  FolderOpen,
  GitBranch,
  GitCommitHorizontal,
  LayoutGrid,
  LoaderCircle,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
  CircleAlert,
  Save,
  Maximize2,
  Minimize2,
  MousePointer2,
} from 'lucide-react';
import { api, ApiError } from './api';
import type {
  Answers,
  CaseDetail,
  CaseSummary,
  Draft,
  FlowEdge,
  FlowNode,
  MediaLine,
  ReadableSnapshot,
  Snapshot,
  Version,
} from '../shared/types';
import { measurementLabels } from '../shared/types';
import { regenerateSnapshot, getIssues, getCanvasGraph } from '../shared/domain';
import FlowCanvas from './FlowCanvas';
import Inspector from './Inspector';
import { AnswerFields, MeasurementBadge, Modal, measureIcons } from './components';
const defaults: Answers = { postback: false, measurements: ['web'] };
function getMediaLines(snapshot: ReadableSnapshot): MediaLine[] {
  if (snapshot.schemaVersion !== 1) return snapshot.mediaLines;
  const name = snapshot.routes
    .find((route) => route.measurement === 'web')
    ?.nodes.find((node) => node.role === 'media')?.title;
  return [
    {
      id: 'default',
      name: name && name !== '媒体' ? name : 'メディアライン1',
      isDirect: snapshot.answers.isDirect,
    },
  ];
}
function lineSummary(snapshot: ReadableSnapshot) {
  const lines = getMediaLines(snapshot);
  return `${lines.length}メディアライン（直メディア ${lines.filter((line) => line.isDirect).length} / ASP経由 ${lines.filter((line) => !line.isDirect).length}）`;
}
const date = (value: string) =>
  new Intl.DateTimeFormat('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export default function App() {
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [working, setWorking] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [answers, setAnswers] = useState<Answers>(defaults);
  const [selected, setSelected] = useState<{ type: 'node' | 'edge'; id: string } | null>(null);
  const [lineFocusId, setLineFocusId] = useState<string | null>(null);
  const [viewVersionId, setViewVersionId] = useState<string | null>(null);
  const [tab, setTab] = useState<'canvas' | 'history'>('canvas');
  const [expanded, setExpanded] = useState(false);
  const [wizard, setWizard] = useState(false);
  const [newName, setNewName] = useState('');
  const [registration, setRegistration] = useState<'new' | 'existing'>('new');
  const [newAnswers, setNewAnswers] = useState<Answers>(defaults);
  const [busy, setBusy] = useState(false);
  const operationLock = useRef(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
    conflict?: boolean;
  } | null>(null);
  const [confirm, setConfirm] = useState<{
    title: string;
    text: string;
    action: () => void | Promise<void>;
  } | null>(null);
  const [pending, setPending] = useState<{ snapshot: Snapshot; removed: string[] } | null>(null);
  const [saveDialog, setSaveDialog] = useState(false);
  const viewVersion = detail?.versions.find((item) => item.id === viewVersionId);
  const rawSnapshot = viewVersion?.snapshot || working?.snapshot;
  const snapshot = rawSnapshot;
  const graph = useMemo(() => (snapshot ? getCanvasGraph(snapshot) : null), [snapshot]);
  const mediaLines = snapshot ? getMediaLines(snapshot) : [];
  const selectedNode =
    selected?.type === 'node' ? graph?.nodes.find((node) => node.id === selected.id) : undefined;
  const focusedLine = mediaLines.find(
    (line) =>
      line.id ===
      (lineFocusId ||
        selectedNode?.mediaLineId ||
        (selectedNode?.role === 'media' && snapshot?.schemaVersion === 1 ? 'default' : null)),
  );
  const isViewing = Boolean(viewVersion);
  const readOnly = isViewing || busy;
  const configDirty = Boolean(working && !isViewing && !same(answers, working.snapshot.answers));
  const issues = useMemo(() => (snapshot ? getIssues(snapshot) : []), [snapshot]);
  const refreshCases = useCallback(async () => {
    const result = await api.list();
    setCases(result.cases);
  }, []);
  useEffect(() => {
    refreshCases()
      .catch((error) => setMessage({ type: 'error', text: String(error.message) }))
      .finally(() => setLoading(false));
  }, [refreshCases]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty || configDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, configDirty]);
  useEffect(() => {
    if (!message || message.type === 'error') return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);
  async function run(action: () => Promise<void>) {
    if (operationLock.current) return;
    operationLock.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '処理に失敗しました。',
        conflict: error instanceof ApiError && error.status === 409,
      });
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  }
  function openWizard() {
    guard(() => {
      setNewName('');
      setNewAnswers(defaults);
      setRegistration('new');
      setWizard(true);
    });
  }
  function guard(action: () => void | Promise<void>) {
    if (operationLock.current) return;
    if (dirty || configDirty)
      setConfirm({
        title: '未保存の変更があります',
        text: '下書きとして保存していない変更は失われます。このまま移動しますか？',
        action,
      });
    else void action();
  }
  function install(data: CaseDetail) {
    setExpanded(false);
    setDetail(data);
    setWorking(data.draft);
    setDirty(false);
    setAnswers(data.draft?.snapshot.answers || data.versions[0]?.snapshot.answers || defaults);
    setViewVersionId(data.draft ? null : data.versions[0]?.id || null);
    setSelected(null);
    setLineFocusId(null);
    setTab('canvas');
  }
  async function openCase(id: string) {
    await run(async () => {
      install(await api.detail(id));
    });
  }
  function editSnapshot(next: Snapshot) {
    if (!working || isViewing || busy || operationLock.current) return;
    setWorking({ ...working, snapshot: next });
    setDirty(true);
  }
  function patchNode(patch: Partial<FlowNode>) {
    if (!working || isViewing || selected?.type !== 'node') return;
    const snapshot = working.snapshot;
    const edited: Snapshot = {
      ...snapshot,
      graph: {
        ...snapshot.graph,
        nodes: snapshot.graph.nodes.map((node) =>
          node.id !== selected.id
            ? node
            : {
                ...node,
                ...patch,
                manual: [
                  ...new Set([
                    ...(node.manual || []),
                    ...Object.keys(patch).filter((key) => key !== 'tag'),
                  ]),
                ],
              },
        ),
      },
    };
    const regenerated = regenerateSnapshot(edited, edited.answers);
    if (regenerated.removed.length) setPending(regenerated);
    else editSnapshot(regenerated.snapshot);
  }
  function patchEdge(patch: Partial<FlowEdge>) {
    if (!working || isViewing || selected?.type !== 'edge') return;
    const snapshot = working.snapshot;
    editSnapshot({
      ...snapshot,
      graph: {
        ...snapshot.graph,
        edges: snapshot.graph.edges.map((edge) =>
          edge.id !== selected.id ? edge : { ...edge, ...patch, manual: true },
        ),
      },
    });
  }
  function applyLineChange(lines: MediaLine[]) {
    if (!working || isViewing || busy || operationLock.current) return;
    const regenerated = regenerateSnapshot(working.snapshot, working.snapshot.answers, lines);
    if (regenerated.removed.length) setPending(regenerated);
    else editSnapshot(regenerated.snapshot);
  }
  function patchMediaLine(patch: Partial<Pick<MediaLine, 'name' | 'isDirect'>>) {
    if (!working || !focusedLine || readOnly || operationLock.current) return;
    if (patch.name !== undefined && !patch.name.trim()) {
      setDirty(true);
      return;
    }
    applyLineChange(
      working.snapshot.mediaLines.map((line) =>
        line.id === focusedLine.id ? { ...line, ...patch } : line,
      ),
    );
  }
  function addMediaLine() {
    if (!working || readOnly || operationLock.current) return;
    let number = working.snapshot.mediaLines.length + 1;
    while (working.snapshot.mediaLines.some((line) => line.name === `メディアライン${number}`))
      number++;
    const line: MediaLine = {
      id: crypto.randomUUID(),
      name: `メディアライン${number}`,
      isDirect: true,
    };
    applyLineChange([...working.snapshot.mediaLines, line]);
    setLineFocusId(line.id);
    setSelected(null);
  }
  function focusMediaLine(line: MediaLine) {
    setLineFocusId(line.id);
    const node = graph?.nodes.find(
      (node) =>
        node.role === 'media' &&
        (node.mediaLineId === line.id || (snapshot?.schemaVersion === 1 && line.id === 'default')),
    );
    setSelected(node ? { type: 'node', id: node.id } : null);
  }
  function removeMediaLine() {
    if (!working || !focusedLine || working.snapshot.mediaLines.length < 2) return;
    const remaining = working.snapshot.mediaLines.filter((line) => line.id !== focusedLine.id);
    const regenerated = regenerateSnapshot(working.snapshot, working.snapshot.answers, remaining);
    setPending({
      ...regenerated,
      removed: [
        `メディアライン「${focusedLine.name}」とその入稿経路を削除します。`,
        ...regenerated.removed,
      ],
    });
  }
  const onPositions = useCallback(
    (changes: { id: string; position: { x: number; y: number } }[]) => {
      if (!working || isViewing || busy || operationLock.current) return;
      setWorking(
        (previous) =>
          previous && {
            ...previous,
            snapshot: {
              ...previous.snapshot,
              graph: {
                ...previous.snapshot.graph,
                nodes: previous.snapshot.graph.nodes.map((node) => {
                  const change = changes.find((value) => value.id === node.id);
                  return change
                    ? {
                        ...node,
                        position: change.position,
                        manual: [...new Set([...(node.manual || []), 'position'])],
                      }
                    : node;
                }),
              },
            },
          },
      );
      setDirty(true);
    },
    [working, isViewing, busy],
  );
  function previewAnswers() {
    if (!working || !answers.measurements.length) return;
    const result = regenerateSnapshot(working.snapshot, answers);
    setPending(result);
  }
  function applyRegeneration() {
    if (!pending) return;
    editSnapshot(pending.snapshot);
    setSelected(null);
    setPending(null);
  }
  async function persistDraft() {
    if (!working) return;
    await run(async () => {
      const { draft } = await api.update(working);
      setWorking(draft);
      setDirty(false);
      await refreshCases();
      setMessage({ type: 'success', text: '下書きを保存しました。' });
    });
  }
  async function saveVersion() {
    if (!working || !detail || !working.reason.trim()) return;
    await run(async () => {
      const updated = dirty ? (await api.update(working)).draft : working;
      // 最初の更新が成功して後続保存が競合しても、再試行に使う改訂番号を失わない。
      setWorking(updated);
      setDirty(false);
      const result = await api.save(updated);
      setWorking(result.draft);
      setAnswers(result.draft.snapshot.answers);
      setDetail({
        ...detail,
        case: { ...detail.case, headVersionId: result.version.id },
        draft: result.draft,
        versions: [result.version, ...detail.versions],
      });
      setSaveDialog(false);
      setViewVersionId(null);
      await refreshCases();
      setMessage({
        type: 'success',
        text: `v${result.version.number}を保存しました。過去のバージョンは保持されています。`,
      });
    });
  }
  async function startFromVersion(version: Version) {
    if (!detail) return;
    const action = async () =>
      run(async () => {
        const result = await api.draft(
          detail.case.id,
          version.id,
          detail.case.headVersionId,
          working?.revision,
        );
        setWorking(result.draft);
        setDetail({ ...detail, draft: result.draft });
        setAnswers(result.draft.snapshot.answers);
        setDirty(false);
        setViewVersionId(null);
        setSelected(null);
        setTab('canvas');
        setMessage({ type: 'success', text: `v${version.number}から下書きを作成しました。` });
      });
    if (working)
      setConfirm({
        title: 'このバージョンから編集しますか？',
        text: '現在の下書きを、このバージョンを元にした下書きに置き換えます。保存済みの履歴は残ります。',
        action,
      });
    else await action();
  }
  function showVersion(version: Version) {
    guard(() => {
      setViewVersionId(version.id);
      setSelected(null);
      setTab('canvas');
    });
  }
  function exportCase() {
    if (!detail) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { exportedAt: new Date().toISOString(), ...detail, draft: working },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${detail.case.name.replace(/[^\p{L}\p{N}_-]/gu, '_')}_導線.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  const visibleCases = cases.filter((item) =>
    item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() =>
            guard(() => {
              setDetail(null);
              setWorking(null);
              setDirty(false);
            })
          }
        >
          <span className="brand-symbol">
            <Workflow size={24} />
          </span>
          <span>
            anken<span className="brand-light">_wires</span>
            <small>案件導線管理</small>
          </span>
        </button>
        <div className="workspace-label">
          WORKSPACE <ChevronDown size={12} />
        </div>
        <button
          className={`nav-item ${!detail ? 'active' : ''}`}
          onClick={() =>
            guard(() => {
              setDetail(null);
              setWorking(null);
              setDirty(false);
            })
          }
        >
          <LayoutGrid size={18} />
          案件一覧<span className="nav-count">{cases.length}</span>
        </button>
        <div className="sidebar-section">
          <span>最近の案件</span>
          <button className="icon-button" aria-label="案件を追加" onClick={openWizard}>
            <Plus size={15} />
          </button>
        </div>
        <div className="recent-cases">
          {cases.slice(0, 8).map((item) => (
            <button
              key={item.id}
              className={`recent-case ${detail?.case.id === item.id ? 'active' : ''}`}
              onClick={() => guard(() => openCase(item.id))}
            >
              <span className="case-dot" />
              <span>{item.name}</span>
            </button>
          ))}
          {cases.length === 0 && <p className="sidebar-empty">作成した案件がここに並びます</p>}
        </div>
        <div className="sidebar-bottom">
          <span className="local-status">
            <span />
            ローカルワークスペース
          </span>
          <p>案件と履歴はこの端末に保存されます</p>
          <div className="sidebar-foot">
            <span className="avatar">AW</span>
            <div>
              導線管理<small>v0.1.0</small>
            </div>
            <ShieldCheck size={17} />
          </div>
        </div>
      </aside>
      <main className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <FolderOpen size={16} />
            <button
              onClick={() =>
                guard(() => {
                  setDetail(null);
                  setWorking(null);
                  setDirty(false);
                })
              }
            >
              案件一覧
            </button>
            {detail && (
              <>
                <ChevronRight size={13} />
                <span>{detail.case.name}</span>
              </>
            )}
          </div>
          <div className="topbar-meta">
            <span className="live-dot" />
            設計をつなぎ、変更を残す
          </div>
        </header>
        {message && (
          <div
            className={`toast ${message.type}`}
            role={message.type === 'error' ? 'alert' : 'status'}
          >
            {message.type === 'error' ? <CircleAlert size={17} /> : <Check size={17} />}
            <span>{message.text}</span>
            {message.conflict && detail && (
              <button onClick={() => guard(() => openCase(detail.case.id))}>
                最新状態を読み込む
              </button>
            )}
            <button
              className="icon-button"
              onClick={() => setMessage(null)}
              aria-label="通知を閉じる"
            >
              <X size={15} />
            </button>
          </div>
        )}
        {!detail ? (
          <div className="overview">
            <div className="page-heading">
              <div>
                <div className="eyebrow">PROJECT WORKSPACE</div>
                <h1>
                  案件一覧<span className="heading-dot">.</span>
                </h1>
                <p>導線を整理して、案件の変化をひとつの場所に。</p>
              </div>
              <button className="button primary" onClick={openWizard}>
                <Plus size={17} />
                新しい案件を作成
              </button>
            </div>
            <div className="stats-grid">
              <div className="stat-card">
                <span className="stat-icon">
                  <FolderOpen size={19} />
                </span>
                <div>
                  <span>管理中の案件</span>
                  <strong>
                    {cases.length}
                    <small>案件</small>
                  </strong>
                </div>
                <span className="stat-caption">すべての導線を一元管理</span>
              </div>
              <div className="stat-card">
                <span className="stat-icon amber">
                  <GitBranch size={19} />
                </span>
                <div>
                  <span>保存したバージョン</span>
                  <strong>
                    {cases.reduce((n, item) => n + item.versionCount, 0)}
                    <small>件</small>
                  </strong>
                </div>
                <span className="stat-caption">変更の経緯をいつでも確認</span>
              </div>
              <div className="stat-card">
                <span className="stat-icon blue">
                  <FileClock size={19} />
                </span>
                <div>
                  <span>編集中の下書き</span>
                  <strong>
                    {cases.filter((item) => item.hasDraft).length}
                    <small>件</small>
                  </strong>
                </div>
                <span className="stat-caption">次の導線を準備する</span>
              </div>
            </div>
            <div className="list-heading">
              <h2>
                すべての案件 <span>{cases.length}</span>
              </h2>
              <label className="search">
                <Search size={16} />
                <input
                  aria-label="案件を検索"
                  placeholder="案件名で検索…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            {loading ? (
              <div className="loading-state">
                <LoaderCircle className="spin" size={24} />
                案件を読み込んでいます
              </div>
            ) : visibleCases.length ? (
              <div className="case-grid">
                {visibleCases.map((item) => (
                  <button className="case-card" key={item.id} onClick={() => openCase(item.id)}>
                    <div className="case-card-top">
                      <span className="case-card-icon">
                        <Workflow size={22} />
                      </span>
                      <span className="case-version">
                        {item.versionCount ? `v${item.versionCount}` : '初回作成中'}
                      </span>
                    </div>
                    <h3>{item.name}</h3>
                    <p>
                      {item.registration === 'new' ? '新規案件' : '既存案件'}
                      {item.hasDraft && <span className="draft-dot">下書きあり</span>}
                    </p>
                    <div className="case-card-footer">
                      <span>
                        <Clock3 size={12} />
                        {date(item.updatedAt)}
                      </span>
                      <ArrowRight size={17} />
                    </div>
                  </button>
                ))}
              </div>
            ) : cases.length ? (
              <div className="empty-search">該当する案件はありません。</div>
            ) : (
              <div className="empty-projects">
                <div className="empty-flow">
                  <span>
                    <GlobeIcon />
                    メディアライン
                  </span>
                  <i />
                  <span>
                    <Workflow size={20} />
                    LP
                  </span>
                  <i />
                  <span>
                    <Check size={20} />
                    CV
                  </span>
                </div>
                <span className="eyebrow">START YOUR FIRST FLOW</span>
                <h2>最初の案件の導線をつくりましょう</h2>
                <p>
                  いくつかの質問に答えるだけで、基本の導線ができあがります。
                  <br />
                  あとは必要な情報を補って、バージョンとして保存。
                </p>
                <button className="button primary" onClick={openWizard}>
                  <Plus size={16} />
                  案件を作成する
                </button>
                <div className="empty-features">
                  <span>
                    <Sparkles size={14} />
                    質問から自動生成
                  </span>
                  <span>
                    <Settings2 size={14} />
                    必要な箇所だけ調整
                  </span>
                  <span>
                    <GitBranch size={14} />
                    変更履歴を保存
                  </span>
                </div>
              </div>
            )}
            <div className="overview-note">
              <ShieldCheck size={16} />
              <span>
                保存済みのバージョンはそのままに。導線の変更は、新しいバージョンで残します。
              </span>
            </div>
          </div>
        ) : (
          <>
            <section className="editor-header">
              <div className="editor-heading">
                <button
                  className="icon-button back-button"
                  aria-label="案件一覧に戻る"
                  onClick={() =>
                    guard(() => {
                      setDetail(null);
                      setWorking(null);
                      setDirty(false);
                    })
                  }
                >
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <div className="editor-title-row">
                    <h1>{detail.case.name}</h1>
                    <span className={`status-badge ${isViewing ? 'saved' : ''}`}>
                      {isViewing ? `v${viewVersion!.number}・保存済み` : '下書き'}
                    </span>
                    {dirty && <span className="unsaved">未保存の変更</span>}
                  </div>
                </div>
              </div>
              <div className="header-actions">
                <button
                  className="icon-button export-button"
                  title="案件データをJSON出力"
                  aria-label="案件データをJSON出力"
                  onClick={exportCase}
                >
                  <Download size={18} />
                </button>
                {!isViewing && working ? (
                  <>
                    <button
                      className="button secondary"
                      disabled={busy || !dirty || configDirty}
                      onClick={persistDraft}
                    >
                      <Save size={15} />
                      下書き保存
                    </button>
                    <button
                      className="button primary"
                      disabled={busy || configDirty}
                      onClick={() => setSaveDialog(true)}
                    >
                      <GitCommitHorizontal size={17} />
                      バージョン保存
                    </button>
                  </>
                ) : (
                  viewVersion && (
                    <button
                      className="button primary"
                      disabled={busy}
                      onClick={() => startFromVersion(viewVersion)}
                    >
                      <GitBranch size={16} />
                      この版から編集
                    </button>
                  )
                )}
              </div>
            </section>
            <div className="editor-tabs">
              <button className={tab === 'canvas' ? 'active' : ''} onClick={() => setTab('canvas')}>
                <Workflow size={16} />
                導線キャンバス
              </button>
              <button
                className={tab === 'history' ? 'active' : ''}
                onClick={() => setTab('history')}
              >
                <Clock3 size={16} />
                変更履歴<span>{detail.versions.length}</span>
              </button>
              {isViewing && working && (
                <button
                  className="return-draft"
                  onClick={() => {
                    setViewVersionId(null);
                    setAnswers(working.snapshot.answers);
                    setSelected(null);
                  }}
                >
                  下書きに戻る
                  <ArrowRight size={14} />
                </button>
              )}
              <div className="editor-tab-note">
                <span className="live-dot" />
                {busy
                  ? '保存処理中…'
                  : isViewing
                    ? '保存版を閲覧中'
                    : dirty
                      ? '下書きの保存が必要です'
                      : '下書き保存済み'}
              </div>
            </div>
            {tab === 'history' ? (
              <div className="history-page">
                <div className="history-heading">
                  <div className="eyebrow">VERSION HISTORY</div>
                  <h2>導線の変更履歴</h2>
                  <p>保存時の構成・配置・注記を、そのまま確認できます。</p>
                </div>
                {!detail.versions.length ? (
                  <div className="empty-history">
                    <GitBranch size={28} />
                    <h3>まだ保存されたバージョンはありません</h3>
                    <p>導線を確認し、「バージョン保存」から最初の履歴を残しましょう。</p>
                    <button className="button secondary" onClick={() => setTab('canvas')}>
                      キャンバスに戻る
                    </button>
                  </div>
                ) : (
                  <div className="timeline">
                    {detail.versions.map((version, index) => (
                      <article className="version-card" key={version.id}>
                        <div className="timeline-marker">
                          <GitCommitHorizontal size={20} />
                        </div>
                        <div className="version-card-heading">
                          <h3>
                            v{version.number}
                            {index === 0 && <span className="latest-label">最新の保存版</span>}
                          </h3>
                          <time>{date(version.createdAt)}</time>
                        </div>
                        <p className="version-reason">{version.reason}</p>
                        <div className="version-measures">
                          {version.snapshot.answers.measurements.map((key) => (
                            <MeasurementBadge value={key} key={key} />
                          ))}
                          <span
                            className={`status-badge ${version.status === 'unresolved' ? 'warning' : 'saved'}`}
                          >
                            {version.status === 'unresolved' ? '未確定事項あり' : '導線定義済み'}
                          </span>
                        </div>
                        <div className="version-card-bottom">
                          <span>
                            {lineSummary(version.snapshot)}
                            <span className="divider">·</span>
                            {version.snapshot.answers.postback ? 'CLポストバック' : 'CVタグ計測'}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => showVersion(version)}
                            aria-label={`v${version.number}を表示`}
                          >
                            この版を表示
                            <ArrowRight size={15} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="editor-body">
                <aside className="configuration">
                  <div className="panel-heading">
                    <Settings2 size={15} />
                    導線の構成
                  </div>
                  <div className="configuration-body">
                    <div className="config-intro">
                      <span className="step-number">01</span>
                      <div>
                        <h3>案件共通の計測設定</h3>
                        <p>入稿経路はメディアラインごとに設定します。</p>
                      </div>
                    </div>
                    <AnswerFields
                      value={isViewing ? snapshot!.answers : answers}
                      onChange={setAnswers}
                      disabled={readOnly}
                    />
                    {!isViewing && (
                      <>
                        <button
                          className={`button ${configDirty ? 'primary' : 'secondary'} regenerate-button`}
                          disabled={busy || !answers.measurements.length || !configDirty}
                          onClick={previewAnswers}
                        >
                          <Sparkles size={15} />
                          変更をプレビュー
                        </button>
                        {configDirty && (
                          <p className="config-dirty">
                            構成が変更されています。プレビューから適用、または
                            <button
                              className="inline-button"
                              onClick={() => setAnswers(working!.snapshot.answers)}
                            >
                              変更を取り消す
                            </button>
                            。
                          </p>
                        )}
                      </>
                    )}
                    <div className="media-lines-section">
                      <div className="media-lines-heading">
                        <h3>
                          メディアライン <span>{mediaLines.length}</span>
                        </h3>
                        {!isViewing && (
                          <button
                            className="icon-button"
                            aria-label="メディアラインを追加"
                            onClick={addMediaLine}
                            disabled={busy || mediaLines.length >= 50}
                          >
                            <Plus size={16} />
                          </button>
                        )}
                      </div>
                      <p className="field-hint">
                        各メディアラインを選び、詳細設定から入稿経路を変更できます。
                      </p>
                      <div className="media-lines-list">
                        {mediaLines.map((line) => (
                          <button
                            key={line.id}
                            className={`media-line-item ${focusedLine?.id === line.id ? 'active' : ''}`}
                            onClick={() => focusMediaLine(line)}
                          >
                            <MousePointer2 size={15} />
                            <span>
                              <strong>{line.name}</strong>
                              <small>{line.isDirect ? '直メディア' : 'ASP経由'}</small>
                            </span>
                            <ChevronRight size={13} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <details className="graph-notes">
                      <summary>
                        図全体の注記{graph?.note && <span className="pending-dot" />}
                      </summary>
                      <label className="field-group">
                        図の注記
                        <textarea
                          aria-label="図の注記"
                          rows={4}
                          maxLength={40000}
                          disabled={readOnly}
                          value={graph?.note || ''}
                          placeholder="図全体に関する確認事項・補足情報"
                          onChange={(event) => {
                            if (working && !isViewing)
                              editSnapshot({
                                ...working.snapshot,
                                graph: { ...working.snapshot.graph, note: event.target.value },
                              });
                          }}
                        />
                      </label>
                    </details>
                    <div className="config-divider" />
                    <div className="issues-heading">
                      <span>確認事項</span>
                      <span className="issue-count">{issues.length}</span>
                    </div>
                    {issues.length ? (
                      <ul className="issue-list">
                        {issues.slice(0, 5).map((issue, index) => (
                          <li key={index}>
                            <CircleAlert size={13} />
                            <span>{issue}</span>
                          </li>
                        ))}
                        {issues.length > 5 && (
                          <li className="muted">
                            ほか{issues.length - 5}件（保存時に確認できます）
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="all-clear">
                        <Check size={14} />
                        未設定の項目はありません
                      </p>
                    )}
                    <div className="config-tip">
                      <ShieldCheck size={18} />
                      <strong>以前の導線も、そのまま。</strong>
                      <p>
                        保存済みのバージョンを上書きせず、変更後の導線を新しい版として残します。
                      </p>
                    </div>
                  </div>
                </aside>
                <section className={`canvas-section ${expanded ? 'expanded' : ''}`}>
                  <div className="route-toolbar">
                    <div className="canvas-modes" aria-label="表示中の計測種別">
                      <span className="unified-label">
                        <Workflow size={14} />
                        全体図
                      </span>
                      {snapshot?.answers.measurements.map((value) => (
                        <MeasurementBadge key={value} value={value} />
                      ))}
                    </div>
                    <div className="canvas-tools">
                      <select
                        aria-label="接続を選択"
                        className="edge-selector"
                        value={selected?.type === 'edge' ? selected.id : ''}
                        onChange={(event) => {
                          setLineFocusId(null);
                          setSelected(
                            event.target.value ? { type: 'edge', id: event.target.value } : null,
                          );
                        }}
                      >
                        <option value="">接続を確認…</option>
                        {graph?.edges.map((edge) => (
                          <option value={edge.id} key={edge.id}>
                            {graph.nodes.find((node) => node.id === edge.source)?.title} →{' '}
                            {graph.nodes.find((node) => node.id === edge.target)?.title}：
                            {edge.label}
                          </option>
                        ))}
                      </select>
                      <button
                        className="icon-button expand-button"
                        aria-label={expanded ? 'キャンバスを元に戻す' : 'キャンバスを広く表示'}
                        onClick={() => setExpanded(!expanded)}
                      >
                        {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                      </button>
                    </div>
                  </div>
                  {graph && (
                    <FlowCanvas
                      key={`${graph.id}-${viewVersionId || 'draft'}-${expanded}`}
                      graph={graph}
                      readOnly={readOnly}
                      selected={selected}
                      onSelect={(value) => {
                        setSelected(value);
                        setLineFocusId(null);
                      }}
                      onPositions={onPositions}
                    />
                  )}
                </section>
                <Inspector
                  mediaLine={focusedLine}
                  onMediaLine={patchMediaLine}
                  onRemoveMediaLine={mediaLines.length > 1 ? removeMediaLine : undefined}
                  node={
                    selected?.type === 'node'
                      ? graph?.nodes.find((item) => item.id === selected.id)
                      : undefined
                  }
                  edge={
                    selected?.type === 'edge'
                      ? graph?.edges.find((item) => item.id === selected.id)
                      : undefined
                  }
                  readOnly={readOnly}
                  onNode={patchNode}
                  onEdge={patchEdge}
                />
              </div>
            )}
          </>
        )}
      </main>
      {busy && (
        <div className="busy-indicator">
          <LoaderCircle size={15} className="spin" />
          処理中
        </div>
      )}
      {wizard && (
        <Modal
          title="新しい案件を作成"
          subtitle="案件の基本情報と計測方法を教えてください。"
          onClose={() => {
            if (!busy) setWizard(false);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!newName.trim() || !newAnswers.measurements.length) return;
              void run(async () => {
                const result = await api.create(newName.trim(), registration, newAnswers);
                install(result);
                await refreshCases();
                setWizard(false);
                setMessage({
                  type: 'success',
                  text: '案件と基本導線を作成しました。URLや注記を補ってください。',
                });
              });
            }}
          >
            <fieldset disabled={busy}>
              <label className="field-group">
                案件名<span className="required">必須</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例：〇〇サービス 新規獲得"
                  maxLength={120}
                  required
                />
              </label>
              <div className="field-group">
                <label>新規案件ですか？</label>
                <div className="segment">
                  <button
                    type="button"
                    aria-pressed={registration === 'new'}
                    className={registration === 'new' ? 'active' : ''}
                    onClick={() => setRegistration('new')}
                  >
                    新規案件
                  </button>
                  <button
                    type="button"
                    aria-pressed={registration === 'existing'}
                    className={registration === 'existing' ? 'active' : ''}
                    onClick={() => setRegistration('existing')}
                  >
                    既存案件を初回登録
                  </button>
                </div>
                <p className="field-hint">登録済みの案件は、案件一覧から選択して編集できます。</p>
              </div>
              <AnswerFields value={newAnswers} onChange={setNewAnswers} />
              <div className="modal-footer">
                <button type="button" className="button secondary" onClick={() => setWizard(false)}>
                  キャンセル
                </button>
                <button
                  className="button primary"
                  type="submit"
                  disabled={!newName.trim() || !newAnswers.measurements.length || busy}
                >
                  <Sparkles size={16} />
                  導線を生成する
                </button>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
      {pending && (
        <Modal
          title="導線の変更を確認"
          subtitle="残るノードの位置・注記・個別設定は引き継ぎます。"
          onClose={() => setPending(null)}
        >
          <div className="regeneration-summary">
            <Workflow size={21} />
            <div>
              {lineSummary(pending.snapshot)} ·{' '}
              {pending.snapshot.answers.postback ? 'CLポストバック' : 'CVタグ計測'}
              <p>
                {pending.snapshot.answers.measurements
                  .map((key) => measurementLabels[key])
                  .join(' / ')}
              </p>
            </div>
          </div>
          {pending.removed.length ? (
            <div className="warning-box">
              <strong>引き継げない手動調整があります</strong>
              <ul>
                {pending.removed.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
              <p>適用すると、この下書きから上記の調整が取り除かれます。</p>
            </div>
          ) : (
            <p className="confirmation-copy">
              削除される手動調整はありません。保存済みのバージョンは変更されません。
            </p>
          )}
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setPending(null)}>
              キャンセル
            </button>
            <button className="button primary" onClick={applyRegeneration}>
              <Check size={16} />
              変更を適用する
            </button>
          </div>
        </Modal>
      )}
      {saveDialog && working && (
        <Modal
          title="バージョンを保存"
          subtitle={`現在の導線をv${(detail?.versions[0]?.number || 0) + 1}として記録します。`}
          onClose={() => {
            if (!busy) setSaveDialog(false);
          }}
        >
          <fieldset disabled={busy}>
            <label className="field-group">
              変更理由<span className="required">必須</span>
              <textarea
                rows={3}
                maxLength={2000}
                placeholder="例：ASP経由の導線に変更"
                value={working.reason}
                onChange={(e) => {
                  setWorking({ ...working, reason: e.target.value });
                  setDirty(true);
                }}
              />
            </label>
            {issues.length > 0 && (
              <details className="save-issues">
                <summary>
                  <CircleAlert size={16} />
                  確認事項 {issues.length}件<span>未確定の状態で保存できます</span>
                </summary>
                <ul>
                  {issues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              </details>
            )}
            <div className="save-explanation">
              <ShieldCheck size={18} />
              <p>
                質問への回答、導線、位置、注記をまとめて保存します。過去のバージョンには影響しません。
              </p>
            </div>
            <div className="modal-footer">
              <button className="button secondary" onClick={() => setSaveDialog(false)}>
                キャンセル
              </button>
              <button
                className="button primary"
                disabled={!working.reason.trim() || busy}
                onClick={saveVersion}
              >
                <GitCommitHorizontal size={17} />
                この内容で保存
              </button>
            </div>
          </fieldset>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="confirmation-copy">{confirm.text}</p>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setConfirm(null)}>
              キャンセル
            </button>
            <button
              className="button primary"
              onClick={() => {
                const action = confirm.action;
                setConfirm(null);
                void action();
              }}
            >
              続ける
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function GlobeIcon() {
  const Icon = measureIcons.web;
  return <Icon size={20} />;
}
