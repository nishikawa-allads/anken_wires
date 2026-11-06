import { useEffect, useRef, useId, type ReactNode } from 'react';
import {
  Check,
  Globe2,
  Smartphone,
  Phone,
  X,
  ArrowUpRight,
  Layers,
  Link2,
  Radio,
  FileCheck2,
  MousePointer2,
  Server,
  CircleHelp,
  MessageCircle,
  Database,
  Headset,
} from 'lucide-react';
import type { Answers, FlowNode, Measurement } from '../shared/types';
import { measurementLabels } from '../shared/types';
export const measureIcons = { web: Globe2, app: Smartphone, phone: Phone, line: MessageCircle };
export const roleIcons = {
  media: MousePointer2,
  aa: Link2,
  lp: Layers,
  thanks: FileCheck2,
  cl: Radio,
  alladin: Server,
  placeholder: CircleHelp,
  phone: Phone,
  'call-data-bank': Phone,
  'call-tracker': Phone,
  'call-center': Headset,
  'phone-records': Database,
  'tracker-records': Database,
  'phone-batch': Server,
  'phone-note': CircleHelp,
  phone_note: CircleHelp,
  'line-friend': MessageCircle,
  'line-friend-add': MessageCircle,
};
export function NodeIcon({ node, size = 19 }: { node: FlowNode; size?: number }) {
  const Icon = roleIcons[node.role as keyof typeof roleIcons] || CircleHelp;
  return <Icon size={size} strokeWidth={1.7} />;
}
export function MeasurementBadge({ value }: { value: Measurement }) {
  const Icon = measureIcons[value];
  return (
    <span className="measurement-badge">
      <Icon size={12} />
      {measurementLabels[value]}
    </span>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, button, select, textarea')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = [
        ...(ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) || []),
      ];
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className={`modal ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <button className="icon-button modal-close" onClick={onClose} aria-label="閉じる">
          <X size={19} />
        </button>
        <div className="eyebrow">ANKEN WIRES</div>
        <h2 id="dialog-title">{title}</h2>
        {subtitle && <p className="muted modal-subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
export function AnswerFields({
  value,
  onChange,
  disabled = false,
}: {
  value: Answers;
  onChange: (answers: Answers) => void;
  disabled?: boolean;
}) {
  const postbackId = useId();
  return (
    <fieldset className="answer-fields" disabled={disabled}>
      <div className="field-group">
        <label htmlFor={postbackId}>CLからのポストバック</label>
        <select
          id={postbackId}
          value={value.postback ? 'yes' : 'no'}
          onChange={(event) => onChange({ ...value, postback: event.target.value === 'yes' })}
        >
          <option value="no">受け取らない（CVタグ計測）</option>
          <option value="yes">受け取る（CLポストバック）</option>
        </select>
        <p className="field-hint">CLポストバック時のCVタグは原則オフ。例外は個別に設定できます。</p>
      </div>
      <div className="field-group">
        <label>
          計測種別 <span className="optional">複数選択可</span>
        </label>
        <div className="measurement-options">
          {(['web', 'app', 'phone', 'line'] as Measurement[]).map((key) => {
            const Icon = measureIcons[key],
              checked = value.measurements.includes(key);
            return (
              <label className={`measure-option ${checked ? 'checked' : ''}`} key={key}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange({
                      ...value,
                      measurements: checked
                        ? value.measurements.filter((item) => item !== key)
                        : [...value.measurements, key],
                    })
                  }
                />
                <Icon size={17} />
                <span>{measurementLabels[key]}</span>
                {checked && <Check size={15} className="option-check" />}
              </label>
            );
          })}
        </div>
      </div>
    </fieldset>
  );
}
export function EmptyNodePanel() {
  return (
    <div className="inspector-empty">
      <div className="empty-icon">
        <ArrowUpRight size={25} />
      </div>
      <h3>導線の詳細を確認</h3>
      <p>
        ノードや接続線を選択すると、
        <br />
        URL・タグ・注記を編集できます。
      </p>
      <div className="tip">
        <MousePointer2 size={15} />
        <span>
          ノードをドラッグして
          <br />
          位置を調整できます
        </span>
      </div>
    </div>
  );
}
