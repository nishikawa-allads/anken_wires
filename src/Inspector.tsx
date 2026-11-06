import { useEffect, useState } from 'react';
import { Info, Link2, SlidersHorizontal, Trash2, MousePointer2 } from 'lucide-react';
import type { FlowNode, FlowEdge, MediaLine } from '../shared/types';
import { EmptyNodePanel, NodeIcon } from './components';
export default function Inspector({
  node,
  edge,
  readOnly,
  onNode,
  onEdge,
  mediaLine,
  onMediaLine,
  onRemoveMediaLine,
}: {
  mediaLine?: MediaLine;
  onMediaLine: (patch: Partial<Pick<MediaLine, 'name' | 'isDirect'>>) => void;
  onRemoveMediaLine?: () => void;
  node?: FlowNode;
  edge?: FlowEdge;
  readOnly: boolean;
  onNode: (patch: Partial<FlowNode>) => void;
  onEdge: (patch: Partial<FlowEdge>) => void;
}) {
  return (
    <aside className="inspector">
      <div className="panel-heading">
        <SlidersHorizontal size={15} />
        <span>詳細設定</span>
        {readOnly && <span className="mini-label">閲覧のみ</span>}
      </div>
      {!node && !edge && !mediaLine ? (
        <EmptyNodePanel />
      ) : (
        <div className="inspector-body">
          {mediaLine && (
            <MediaLineFields
              key={mediaLine.id}
              line={mediaLine}
              readOnly={readOnly}
              onChange={onMediaLine}
              onRemove={onRemoveMediaLine}
            />
          )}
          {node ? (
            <>
              <div className="inspector-node-heading">
                <span className={`node-icon role-${node.role}`}>
                  <NodeIcon node={node} />
                </span>
                <div>
                  <span className="eyebrow">NODE DETAILS</span>
                  <h3>{node.title}</h3>
                </div>
              </div>
              <fieldset disabled={readOnly}>
                {node.role !== 'media' && (
                  <label className="field-group">
                    表示名
                    <input
                      value={node.title}
                      onChange={(e) => onNode({ title: e.target.value })}
                      maxLength={120}
                    />
                  </label>
                )}
                <label className="field-group">
                  所属システム
                  <input
                    value={node.system}
                    onChange={(e) => onNode({ system: e.target.value })}
                    placeholder="例：ALLADiN"
                    maxLength={160}
                  />
                </label>
                <label className="field-group">
                  URL
                  <input
                    aria-label="URL"
                    value={node.url}
                    onChange={(e) => onNode({ url: e.target.value })}
                    placeholder="https://…"
                    maxLength={2048}
                  />
                  <span className="field-hint">
                    入稿URL・LP URLなど。自動アクセスは行いません。
                  </span>
                </label>
                {node.tag && (
                  <div className="tag-settings">
                    <h4>
                      <span className="tag-dot" />
                      {node.role === 'lp' ? 'LPタグ' : 'CVタグ'}の設定
                    </h4>
                    <label className="field-group">
                      タグの使用
                      <select
                        value={node.tag.usage}
                        onChange={(e) =>
                          onNode({
                            tag: {
                              ...node.tag!,
                              usage: e.target.value as 'enabled' | 'disabled' | 'undecided',
                              source: 'manual',
                            },
                          })
                        }
                      >
                        <option value="enabled">使用する</option>
                        <option value="disabled">使用しない</option>
                        <option value="undecided">未定</option>
                      </select>
                    </label>
                    {node.tag.usage !== 'disabled' && (
                      <>
                        <label className="field-group">
                          送信先
                          <input
                            value={node.tag.destination}
                            onChange={(e) =>
                              onNode({
                                tag: {
                                  ...node.tag!,
                                  destination: e.target.value,
                                  source: 'manual',
                                },
                              })
                            }
                            placeholder="例：ALLADiN / CLの計測ツール"
                            maxLength={160}
                          />
                        </label>
                        <label className="field-group">
                          役割
                          <input
                            value={node.tag.role}
                            onChange={(e) =>
                              onNode({
                                tag: { ...node.tag!, role: e.target.value, source: 'manual' },
                              })
                            }
                            placeholder="例：成果通知・補助計測"
                            maxLength={300}
                          />
                        </label>
                        <label className="field-group">
                          発火条件
                          <input
                            value={node.tag.condition}
                            onChange={(e) =>
                              onNode({
                                tag: { ...node.tag!, condition: e.target.value, source: 'manual' },
                              })
                            }
                            placeholder="例：申込完了時"
                            maxLength={300}
                          />
                        </label>
                      </>
                    )}
                    <p className="field-hint">
                      {node.tag.source === 'manual'
                        ? '個別設定：導線の再生成時も保持します。'
                        : '導線の構成に応じた初期設定です。'}
                    </p>
                  </div>
                )}
                <label className="field-group">
                  注記
                  <textarea
                    aria-label="注記"
                    rows={4}
                    value={node.note}
                    onChange={(e) => onNode({ note: e.target.value })}
                    placeholder="設定上の注意・確認事項など"
                    maxLength={3000}
                  />
                </label>
              </fieldset>
              <div className="inspector-footnote">
                <Info size={14} />
                <span>
                  この図は導線の設計情報です。タグやCVの実動作を保証するものではありません。
                </span>
              </div>
            </>
          ) : (
            edge && (
              <>
                <div className="inspector-node-heading">
                  <span className="node-icon">
                    <Link2 size={20} />
                  </span>
                  <div>
                    <span className="eyebrow">CONNECTION</span>
                    <h3>接続の詳細</h3>
                  </div>
                </div>
                <fieldset disabled={readOnly}>
                  <label className="field-group">
                    接続ラベル
                    <input
                      value={edge.label}
                      onChange={(e) => onEdge({ label: e.target.value })}
                      maxLength={200}
                    />
                  </label>
                  <label className="field-group">
                    受け渡す識別子
                    <input
                      value={edge.identifier}
                      onChange={(e) => onEdge({ identifier: e.target.value })}
                      maxLength={500}
                    />
                    <span className="field-hint">
                      affnmsid、ASPクリック識別子などを区別して記載します。
                    </span>
                  </label>
                  <label className="field-group">
                    接続種別
                    <select value={edge.kind} disabled>
                      <option value="navigation">遷移・リダイレクト</option>
                      <option value="notification">計測・通知</option>
                      <option value="phone">電話接続</option>
                    </select>
                  </label>
                </fieldset>
              </>
            )
          )}
        </div>
      )}
    </aside>
  );
}

function MediaLineFields({
  line,
  readOnly,
  onChange,
  onRemove,
}: {
  line: MediaLine;
  readOnly: boolean;
  onChange: (patch: Partial<Pick<MediaLine, 'name' | 'isDirect'>>) => void;
  onRemove?: () => void;
}) {
  const [name, setName] = useState(line.name);
  const [nameError, setNameError] = useState(false);
  useEffect(() => {
    setName(line.name);
    setNameError(false);
  }, [line.name]);
  return (
    <div className="line-settings">
      <div className="line-settings-heading">
        <MousePointer2 size={17} />
        <h3>メディアラインの設定</h3>
      </div>
      <fieldset disabled={readOnly}>
        <label className="field-group">
          メディアライン名
          <input
            aria-label="メディアライン名"
            value={name}
            maxLength={120}
            aria-invalid={nameError}
            onChange={(event) => {
              setName(event.target.value);
              onChange({ name: event.target.value });
              setNameError(!event.target.value.trim());
            }}
            onBlur={() => {
              const next = name.trim();
              if (!next) {
                setName(line.name);
                setNameError(true);
                return;
              }
              if (next !== line.name) onChange({ name: next });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
          {nameError && (
            <span className="field-error">名前は空欄にできないため、元の名前を保持しました。</span>
          )}
        </label>
        <label className="field-group">
          入稿経路
          <select
            aria-label="入稿経路"
            value={line.isDirect ? 'direct' : 'asp'}
            onChange={(event) => onChange({ isDirect: event.target.value === 'direct' })}
          >
            <option value="direct">直メディア（ASPなし）</option>
            <option value="asp">ASP経由</option>
          </select>
          <span className="field-hint">
            このメディアラインだけに適用します。
            {line.isDirect
              ? 'AA入稿URLからLPへ流入します。'
              : 'ASP入稿URLからAA入稿URLへリダイレクトします。'}
          </span>
        </label>
        {onRemove && (
          <button type="button" className="line-remove" onClick={onRemove}>
            <Trash2 size={13} />
            このメディアラインを削除
          </button>
        )}
      </fieldset>
    </div>
  );
}
