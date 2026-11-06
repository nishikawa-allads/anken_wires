import { useMemo, useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useReactFlow,
  useNodesInitialized,
  type NodeProps,
  type FitViewOptions,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import { Globe2, Info } from 'lucide-react';
import type { FlowNode, Graph } from '../shared/types';
import { NodeIcon, MeasurementBadge } from './components';
type CanvasNode = Node<{ flow: FlowNode; readonly: boolean }, 'flow'>;
function FlowCard({ data, selected }: NodeProps<CanvasNode>) {
  const node = data.flow;
  const tagText =
    node.tag?.usage === 'enabled'
      ? node.role === 'lp'
        ? 'LPタグ発火'
        : 'CVタグ発火'
      : node.tag?.usage === 'disabled'
        ? node.role === 'lp'
          ? 'LPタグなし'
          : 'CVタグなし'
        : 'タグ使用は未定';
  return (
    <div
      className={`flow-card role-${node.role} ${selected ? 'selected' : ''}`}
      data-measurement={node.measurement}
    >
      <Handle id="target-left" type="target" position={Position.Left} />
      <div className="flow-card-header">
        <span className="node-icon">
          <NodeIcon node={node} />
        </span>
        <span className="node-role">
          {node.role === 'media'
            ? '流入元'
            : ['alladin', 'cl'].includes(node.role)
              ? '計測・成果'
              : node.role === 'aa'
                ? 'リダイレクト'
                : ['placeholder', 'phone_note'].includes(node.role)
                  ? '確認事項'
                  : ['call-data-bank', 'call-tracker', 'call-center'].includes(node.role)
                    ? '電話接続'
                    : ['phone-records', 'tracker-records'].includes(node.role)
                      ? '通話記録'
                      : node.role === 'phone-batch'
                        ? 'データ取得'
                        : node.role === 'line-friend-add'
                          ? 'LINEイベント'
                          : 'ページ'}
        </span>
        <span className={`node-status ${node.role === 'placeholder' ? 'pending' : ''}`} />
      </div>
      {node.measurement && (
        <div className="node-measurement">
          <MeasurementBadge value={node.measurement} />
        </div>
      )}
      <div className="node-title">{node.title}</div>
      <div className="node-url">
        {node.url ? (
          <>
            <Globe2 size={11} />
            <span>{node.url}</span>
          </>
        ) : (
          <span>
            {![
              'media',
              'aa',
              'lp',
              'thanks',
              'line-friend-add',
              'placeholder',
              'phone_note',
            ].includes(node.role)
              ? node.system || '計測・連携'
              : ['placeholder', 'phone_note'].includes(node.role)
                ? '導線の仕様を確認してください'
                : 'URL未設定'}
          </span>
        )}
      </div>
      {node.tag && (
        <div className={`node-tag ${node.tag.usage}`}>
          <span />
          {tagText}
        </div>
      )}
      {node.note && <div className="node-note">{node.note}</div>}
      <Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="source-left" type="source" position={Position.Left} />
      <Handle id="target-right" type="target" position={Position.Right} />
      <Handle id="source-top" type="source" position={Position.Top} />
      <Handle id="target-top" type="target" position={Position.Top} />
      <Handle id="source-bottom" type="source" position={Position.Bottom} />
      <Handle id="target-bottom" type="target" position={Position.Bottom} />
    </div>
  );
}
const nodeTypes = { flow: FlowCard };
export default function FlowCanvas(props: {
  graph: Graph;
  readOnly: boolean;
  selected: { type: 'node' | 'edge'; id: string } | null;
  onSelect: (value: { type: 'node' | 'edge'; id: string } | null) => void;
  onPositions: (changes: { id: string; position: { x: number; y: number } }[]) => void;
}) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
function Canvas({
  graph,
  readOnly,
  selected,
  onSelect,
  onPositions,
}: Parameters<typeof FlowCanvas>[0]) {
  const { fitView } = useReactFlow();
  const fitOptions = useMemo<FitViewOptions>(
    () => ({
      padding: {
        top: graph.status === 'unresolved' ? '150px' : '100px',
        bottom: '90px',
        left: '70px',
        right: '70px',
      },
      maxZoom: 1,
    }),
    [graph.status],
  );
  const initialized = useNodesInitialized();
  const layoutKey = graph.nodes.map((node) => node.id).join('|');
  const fittedLayout = useRef('');
  useEffect(() => {
    if (initialized && fittedLayout.current !== layoutKey) {
      fittedLayout.current = layoutKey;
      void fitView(fitOptions);
    }
  }, [initialized, layoutKey, fitView, fitOptions]);
  const [nodes, setNodes, applyChanges] = useNodesState<CanvasNode>(
    graph.nodes.map((node) => ({
      id: node.id,
      type: 'flow',
      position: node.position,
      data: { flow: node, readonly: readOnly },
    })),
  );
  useEffect(() => {
    // 寸法計測はキャンバス内で保持する。業務モデルの更新でmeasuredを失うとノードが非表示になる。
    setNodes((previous) =>
      graph.nodes.map((node) => ({
        ...previous.find((item) => item.id === node.id),
        id: node.id,
        type: 'flow',
        position: node.position,
        data: { flow: node, readonly: readOnly },
        selected: selected?.type === 'node' && selected.id === node.id,
      })),
    );
  }, [graph.nodes, readOnly, selected, setNodes]);
  const edges = useMemo(
    () =>
      graph.edges.map((edge) => {
        const source = graph.nodes.find((node) => node.id === edge.source);
        const target = graph.nodes.find((node) => node.id === edge.target);
        const deltaX = (target?.position.x ?? 0) - (source?.position.x ?? 0);
        const deltaY = (target?.position.y ?? 0) - (source?.position.y ?? 0);
        const ports =
          deltaY < -200
            ? { sourceHandle: 'source-top', targetHandle: 'target-bottom' }
            : Math.abs(deltaX) < 100 && deltaY > 200
              ? { sourceHandle: 'source-bottom', targetHandle: 'target-top' }
              : deltaX < 0 && Math.abs(deltaY) < 100
                ? { sourceHandle: 'source-left', targetHandle: 'target-right' }
                : { sourceHandle: 'source-right', targetHandle: 'target-left' };
        // 横並びのカード間では長い識別子が隠れないよう上側にラベルを置く。
        const labelTransform =
          source && target && Math.abs(source.position.y - target.position.y) < 30
            ? 'translateY(-100px)'
            : 'translateY(-16px)';
        return {
          ...edge,
          ...ports,
          type: 'smoothstep',
          label: `${edge.label}${edge.identifier ? ` · ${edge.identifier}` : ''}`,
          selected: selected?.type === 'edge' && selected.id === edge.id,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color:
              edge.kind === 'notification'
                ? '#b98c51'
                : edge.kind === 'phone'
                  ? '#648f9b'
                  : '#6b837b',
          },
          style: {
            stroke:
              edge.kind === 'notification'
                ? '#b98c51'
                : edge.kind === 'phone'
                  ? '#648f9b'
                  : '#6b837b',
            strokeWidth: selected?.id === edge.id ? 2.5 : 1.5,
            strokeDasharray:
              edge.kind === 'notification' ? '5 5' : edge.kind === 'phone' ? '2 4' : undefined,
          },
          labelStyle: { fill: '#69716b', fontSize: 10, fontWeight: 500, transform: labelTransform },
          labelBgStyle: { fill: '#fbfcfa', fillOpacity: 0.96, transform: labelTransform },
          labelBgPadding: [8, 5] as [number, number],
          labelBgBorderRadius: 4,
        };
      }),
    [graph.edges, graph.nodes, selected],
  );
  const handleChanges = useCallback(
    (changes: NodeChange<CanvasNode>[]) => {
      applyChanges(changes);
      const positions = changes.flatMap((change) =>
        change.type === 'position' && change.position
          ? [{ id: change.id, position: change.position }]
          : [],
      );
      if (positions.length && !readOnly) onPositions(positions);
    },
    [readOnly, onPositions, applyChanges],
  );
  return (
    <div className="flow-canvas" data-testid="flow-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleChanges}
        onNodeClick={(_, node) => onSelect({ type: 'node', id: node.id })}
        onEdgeClick={(_, edge) => onSelect({ type: 'edge', id: edge.id })}
        onPaneClick={() => onSelect(null)}
        nodesDraggable={!readOnly}
        nodesConnectable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        fitView
        fitViewOptions={fitOptions}
        minZoom={0.25}
        maxZoom={1.6}
        proOptions={{ hideAttribution: false }}
        ariaLabelConfig={{
          'controls.zoomIn.ariaLabel': '拡大',
          'controls.zoomOut.ariaLabel': '縮小',
          'controls.fitView.ariaLabel': '全体を表示',
          'controls.interactive.ariaLabel': '操作を切り替え',
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#d6ded7" />
        <Controls showInteractive={false} fitViewOptions={fitOptions} />
        <MiniMap pannable zoomable nodeColor="#d9e7df" maskColor="rgba(244,247,243,.7)" />
        {graph.status === 'unresolved' && (
          <div className="canvas-notice">
            <Info size={16} />
            <span>参考構成・未確定の導線を含みます。図内の確認事項を補って保存できます。</span>
          </div>
        )}
      </ReactFlow>
      <div className="canvas-legend">
        <span>
          <i />
          遷移・リダイレクト
        </span>
        <span>
          <i className="notification" />
          計測・通知
        </span>
        <span>
          <i className="phone" />
          電話接続
        </span>
      </div>
    </div>
  );
}
