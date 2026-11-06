export type Measurement = 'web' | 'app' | 'phone' | 'line';
export interface Answers {
  postback: boolean;
  measurements: Measurement[];
}
export interface MediaLine {
  id: string;
  name: string;
  isDirect: boolean;
}
export interface LegacyAnswers extends Answers {
  isDirect: boolean;
}
export interface TagConfig {
  usage: 'enabled' | 'disabled' | 'undecided';
  source: 'default' | 'manual';
  destination: string;
  role: string;
  condition: string;
}
export interface FlowNode {
  measurement?: Measurement;
  mediaLineId?: string;
  id: string;
  role: string;
  title: string;
  system: string;
  url: string;
  note: string;
  position: { x: number; y: number };
  tag?: TagConfig;
  manual?: string[];
}
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  kind: 'navigation' | 'notification' | 'phone';
  label: string;
  identifier: string;
  manual?: boolean;
}
export interface Route {
  id: string;
  measurement: Measurement;
  templateVersion: number;
  nodes: FlowNode[];
  edges: FlowEdge[];
  status: 'defined' | 'unresolved';
  note: string;
}
export interface Graph {
  id: 'main';
  templateVersion: 3;
  nodes: FlowNode[];
  edges: FlowEdge[];
  status: 'defined' | 'unresolved';
  note: string;
}
export interface Snapshot {
  answers: Answers;
  graph: Graph;
  mediaLines: MediaLine[];
  generatorVersion: 3;
  schemaVersion: 3;
}
export interface LegacyV2Snapshot {
  answers: Answers;
  routes: Route[];
  mediaLines: MediaLine[];
  generatorVersion: 2;
  schemaVersion: 2;
}
export interface LegacySnapshot {
  answers: LegacyAnswers;
  routes: Route[];
  generatorVersion: 1;
  schemaVersion: 1;
}
export type ReadableSnapshot = Snapshot | LegacyV2Snapshot | LegacySnapshot;
export interface CaseRecord {
  id: string;
  name: string;
  registration: 'new' | 'existing';
  headVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CaseSummary extends CaseRecord {
  versionCount: number;
  hasDraft: boolean;
}
export interface Draft {
  id: string;
  caseId: string;
  baseVersionId: string | null;
  expectedHeadId: string | null;
  revision: number;
  snapshot: Snapshot;
  reason: string;
  updatedAt: string;
}
export interface Version {
  id: string;
  caseId: string;
  number: number;
  baseVersionId: string | null;
  snapshot: ReadableSnapshot;
  reason: string;
  createdAt: string;
  status: 'defined' | 'unresolved';
}
export interface CaseDetail {
  case: CaseRecord;
  draft: Draft | null;
  versions: Version[];
}
export const measurementLabels: Record<Measurement, string> = {
  web: 'Web計測',
  app: 'アプリ計測',
  phone: '電話計測',
  line: 'LINE友だち追加',
};
