import type { Answers, CaseDetail, CaseSummary, Draft, Version } from '../shared/types';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(
      body.error || '処理に失敗しました。もう一度お試しください。',
      response.status,
    );
  return body as T;
}
export const api = {
  list: () => request<{ cases: CaseSummary[] }>('/cases'),
  detail: (id: string) => request<CaseDetail>(`/cases/${id}`),
  create: (name: string, registration: 'new' | 'existing', answers: Answers) =>
    request<CaseDetail>('/cases', {
      method: 'POST',
      body: JSON.stringify({ name, registration, answers }),
    }),
  draft: (
    caseId: string,
    baseVersionId: string | null,
    expectedHeadId: string | null,
    replaceRevision?: number,
  ) =>
    request<{ draft: Draft }>(`/cases/${caseId}/draft`, {
      method: 'POST',
      body: JSON.stringify({ baseVersionId, expectedHeadId, replaceRevision }),
    }),
  update: (draft: Draft) =>
    request<{ draft: Draft }>(`/drafts/${draft.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        revision: draft.revision,
        snapshot: draft.snapshot,
        reason: draft.reason,
      }),
    }),
  save: (draft: Draft) =>
    request<{ version: Version; draft: Draft }>(`/drafts/${draft.id}/versions`, {
      method: 'POST',
      body: JSON.stringify({ revision: draft.revision }),
    }),
};
