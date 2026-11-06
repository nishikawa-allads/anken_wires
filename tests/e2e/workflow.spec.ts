import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { generateSnapshot as generateV2Snapshot } from '../../shared/legacy-v2-domain';
import { test, expect, type Page } from '@playwright/test';
const unique = (prefix: string) => `${prefix} ${Date.now()}`;
async function createCase(page: Page, name: string, postback = false) {
  await page.getByRole('button', { name: '新しい案件を作成', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('textbox', { name: '案件名' }).fill(name);
  if (postback) await modal.getByLabel('CLからのポストバック').selectOption('yes');
  await modal.getByRole('button', { name: '導線を生成する' }).click();
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}
async function save(page: Page, reason: string) {
  await page.getByRole('button', { name: 'バージョン保存', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('textbox', { name: '変更理由' }).fill(reason);
  await modal.getByRole('button', { name: 'この内容で保存' }).click();
  await expect(modal).not.toBeVisible();
}
test('案件の作成・タグ例外・ドラッグ・再生成・履歴保存・再読込', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const name = unique('Web導線テスト');
  await createCase(page, name, true);
  await page.locator('.react-flow__node[data-id="web-thanks"]').click();
  const panel = page.locator('.inspector');
  await expect(panel.getByLabel('タグの使用')).toHaveValue('disabled');
  await panel.getByLabel('タグの使用').selectOption('enabled');
  await panel.getByLabel('送信先', { exact: true }).fill('ALLADiN');
  await panel.getByLabel('役割', { exact: true }).fill('例外の補助計測');
  await panel.getByLabel('注記').fill('個別設定を保持する');
  await expect(page.locator('[data-id="web-thanks-alladin"]')).toBeVisible();
  const target = page.locator('.react-flow__node[data-id="web-thanks"]');
  const before = await target.getAttribute('style');
  const box = await target.boundingBox();
  await page.mouse.move(box!.x + 80, box!.y + 22);
  await page.mouse.down();
  await page.mouse.move(box!.x + 110, box!.y - 28, { steps: 8 });
  await page.mouse.up();
  await expect(target).not.toHaveAttribute('style', before!);
  await page.getByRole('button', { name: '下書き保存', exact: true }).click();
  await expect(page.getByText('下書きを保存しました。', { exact: true })).toBeVisible();
  await page.reload();
  await page
    .locator('.case-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .click();
  await page.locator('.react-flow__node[data-id="web-thanks"]').click();
  await expect(panel.getByLabel('注記')).toHaveValue('個別設定を保持する');
  await save(page, '初回・CLポストバック＋CVタグ例外');
  await page.locator('.media-line-item').filter({ hasText: 'メディアライン1' }).click();
  await panel.getByLabel('入稿経路', { exact: true }).selectOption('asp');
  await expect(page.locator('[data-id="web-aa"]')).toBeVisible();
  await page.locator('.react-flow__node[data-id="web-thanks"]').click();
  await expect(panel.getByLabel('タグの使用')).toHaveValue('enabled');
  await expect(panel.getByLabel('注記')).toHaveValue('個別設定を保持する');
  await save(page, 'ASP経由へ変更');
  await page.getByRole('button', { name: '変更履歴' }).click();
  await page.getByRole('button', { name: 'v1を表示', exact: true }).click();
  await expect(page.locator('[data-id="web-aa"]')).toHaveCount(0);
  await expect(page.getByText('v1・保存済み', { exact: true })).toBeVisible();
  await page.locator('.react-flow__node[data-id="web-thanks"]').click();
  await expect(panel.getByLabel('注記')).toHaveValue('個別設定を保持する');
  await expect(panel.getByLabel('注記')).toBeDisabled();
  await page.screenshot({ path: '.context/screenshots/web-flow.png', fullPage: true });
  await page.getByRole('button', { name: 'キャンバスを広く表示' }).click();
  await expect(page.locator('[data-id="web-thanks"]')).toBeVisible();
  await page.screenshot({ path: '.context/screenshots/canvas-expanded.png', fullPage: true });
  await page.getByRole('button', { name: 'キャンバスを元に戻す' }).click();
  expect(errors).toEqual([]);
});
test('新規案件への移動で未保存変更を保護し、未対応の計測種別を保存できる', async ({ page }) => {
  await page.goto('/');
  await createCase(page, unique('複数計測テスト'));
  await page.locator('[data-id="web-lp"]').click();
  await page.locator('.inspector').getByLabel('注記').fill('保存前のメモ');
  await page.getByRole('button', { name: '案件を追加', exact: true }).click();
  await expect(page.getByRole('heading', { name: '未保存の変更があります' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.locator('.inspector').getByLabel('注記')).toHaveValue('保存前のメモ');
  await page.locator('.configuration').getByLabel('アプリ計測', { exact: true }).check();
  await page.locator('.configuration').getByLabel('電話計測', { exact: true }).check();
  await page.getByRole('button', { name: '変更をプレビュー' }).click();
  await page.getByRole('button', { name: '変更を適用する' }).click();
  await expect(page.getByTestId('flow-canvas')).toHaveCount(1);
  await expect(page.locator('.route-tabs')).toHaveCount(0);
  await expect(page.locator('[data-id="phone-call-data-bank"]')).toBeVisible();
  await expect(page.locator('[data-id="app-placeholder"]')).toBeVisible();
  await expect(page.locator('[data-id="web-lp"]')).toBeVisible();
  await save(page, 'Web・アプリ・電話を含む検討版');
  await page.getByRole('button', { name: '変更履歴' }).click();
  await expect(page.getByText('未確定事項あり', { exact: true })).toBeVisible();
});
test('タグ変更で消える手動接続は確認し、キャンセルで保持する', async ({ page }) => {
  await page.goto('/');
  await createCase(page, unique('タグ経路の保護テスト'), true);
  const thanks = page.locator('.react-flow__node[data-id="web-thanks"]');
  const panel = page.locator('.inspector');
  await thanks.click();
  await panel.getByLabel('タグの使用').selectOption('enabled');
  await panel.getByLabel('送信先', { exact: true }).fill('ALLADiN');
  await page.getByLabel('接続を選択').selectOption('web-thanks-alladin');
  await expect(panel.getByLabel('接続種別')).toBeDisabled();
  await panel.getByLabel('接続ラベル').fill('例外タグの手動経路');
  await thanks.click();
  await panel.getByLabel('タグの使用').selectOption('disabled');
  await expect(page.getByRole('dialog')).toContainText('例外タグの手動経路');
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click();
  await expect(panel.getByLabel('タグの使用')).toHaveValue('enabled');
  await expect(page.locator('[data-id="web-thanks-alladin"]')).toBeVisible();
  await panel.getByLabel('タグの使用').selectOption('disabled');
  await page.getByRole('dialog').getByRole('button', { name: '変更を適用する' }).click();
  await expect(page.locator('[data-id="web-thanks-alladin"]')).toHaveCount(0);
  await save(page, '例外タグの経路を確認して削除');
});
test('狭い画面でも案件を作成して導線を確認できる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await createCase(page, unique('モバイル表示テスト'));
  await expect(page.getByTestId('flow-canvas')).toBeVisible();
  const width = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.page).toBeLessThanOrEqual(width.viewport);
  await page.screenshot({ path: '.context/screenshots/mobile.png', fullPage: true });
});
test('保存応答が遅い間に別案件へ切り替えて状態を混在させない', async ({ page }) => {
  const a = unique('保存待ちA'),
    b = unique('保存待ちB');
  await page.goto('/');
  await createCase(page, a);
  await page.getByRole('button', { name: '案件を追加', exact: true }).click();
  const modal = page.getByRole('dialog');
  await modal.getByRole('textbox', { name: '案件名' }).fill(b);
  await modal.getByRole('button', { name: '導線を生成する' }).click();
  await expect(page.getByRole('heading', { name: b, exact: true })).toBeVisible();
  await page.locator('.recent-case').filter({ hasText: a }).click();
  await expect(page.getByRole('heading', { name: a, exact: true })).toBeVisible();
  await page.locator('[data-id="web-lp"]').click();
  await page.locator('.inspector').getByLabel('注記').fill('案件Aのメモ');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let received!: () => void;
  const intercepted = new Promise<void>((resolve) => {
    received = resolve;
  });
  await page.route('**/api/drafts/*', async (route) => {
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: '下書き保存', exact: true }).click();
  await intercepted;
  await page.locator('.recent-case').filter({ hasText: b }).click();
  await expect(page.getByRole('heading', { name: a, exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  release();
  await expect(page.getByText('下書きを保存しました。', { exact: true })).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
  await page.locator('.recent-case').filter({ hasText: b }).click();
  await expect(page.getByRole('heading', { name: b, exact: true })).toBeVisible();
  await page.locator('[data-id="web-lp"]').click();
  await expect(page.locator('.inspector').getByLabel('注記')).toHaveValue('');
});

test('入稿経路をメディアラインごとに設定し、混在・個別変更・履歴を保持する', async ({ page }) => {
  const name = unique('メディアライン別入稿経路');
  await page.goto('/');
  await page.getByRole('button', { name: '新しい案件を作成', exact: true }).click();
  const create = page.getByRole('dialog');
  await expect(create.getByText('媒体の入稿経路', { exact: true })).toHaveCount(0);
  await expect(create.getByLabel('入稿経路', { exact: true })).toHaveCount(0);
  await create.getByRole('textbox', { name: '案件名' }).fill(name);
  await create.getByRole('button', { name: '導線を生成する' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const panel = page.locator('.inspector');
  const line1 = page.locator('.media-line-item').filter({ hasText: 'メディアライン1' });
  await line1.click();
  await panel.getByLabel('メディアライン名', { exact: true }).fill('直入稿ライン');
  await panel.getByLabel('メディアライン名', { exact: true }).press('Tab');
  await panel.getByLabel('URL', { exact: true }).fill('https://aa.example.test/direct');
  await panel.getByLabel('注記', { exact: true }).fill('直入稿の注記を保持');
  await expect(panel.getByLabel('入稿経路', { exact: true })).toHaveValue('direct');
  await page.getByRole('button', { name: 'メディアラインを追加', exact: true }).click();
  await panel.getByLabel('メディアライン名', { exact: true }).fill('ASP経由ライン');
  await panel.getByLabel('メディアライン名', { exact: true }).press('Tab');
  await panel.getByLabel('入稿経路', { exact: true }).selectOption('asp');
  await page.locator('.media-line-item').filter({ hasText: 'ASP経由ライン' }).click();
  await panel.getByLabel('URL', { exact: true }).fill('https://asp.example.test/entry');
  await expect(
    page
      .locator('.react-flow__node')
      .filter({ hasText: 'AA入稿URL' })
      .filter({ hasText: 'リダイレクト' }),
  ).toHaveCount(1);
  await page.locator('.media-line-item').filter({ hasText: '直入稿ライン' }).click();
  await expect(panel.getByLabel('入稿経路', { exact: true })).toHaveValue('direct');
  await expect(panel.getByLabel('URL', { exact: true })).toHaveValue(
    'https://aa.example.test/direct',
  );
  await expect(panel.getByLabel('注記', { exact: true })).toHaveValue('直入稿の注記を保持');
  await save(page, '直入稿とASP経由を併用');
  const cases = await (await page.request.get('/api/cases')).json();
  const id = cases.cases.find((item: { name: string }) => item.name === name).id;
  let detail = await (await page.request.get(`/api/cases/${id}`)).json();
  expect(detail.draft.snapshot.answers).not.toHaveProperty('isDirect');
  expect(
    detail.draft.snapshot.mediaLines.map((line: { isDirect: boolean }) => line.isDirect),
  ).toEqual([true, false]);
  const aspLine = detail.draft.snapshot.mediaLines[1];
  const aa = page.locator(`.react-flow__node[data-id="web-aa-${aspLine.id}"]`);
  await aa.click();
  await panel.getByLabel('注記', { exact: true }).fill('削除前に確認する設定');
  await panel.getByLabel('入稿経路', { exact: true }).selectOption('direct');
  await expect(page.getByRole('dialog')).toContainText('削除前に確認する設定');
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click();
  await expect(panel.getByLabel('入稿経路', { exact: true })).toHaveValue('asp');
  await panel.getByLabel('入稿経路', { exact: true }).selectOption('direct');
  await page.getByRole('dialog').getByRole('button', { name: '変更を適用する' }).click();
  await save(page, '2つ目のラインだけ直入稿へ変更');
  detail = await (await page.request.get(`/api/cases/${id}`)).json();
  expect(
    detail.versions[0].snapshot.mediaLines.map((line: { isDirect: boolean }) => line.isDirect),
  ).toEqual([true, true]);
  expect(
    detail.versions[1].snapshot.mediaLines.map((line: { isDirect: boolean }) => line.isDirect),
  ).toEqual([true, false]);
  await page.reload();
  await page
    .locator('.case-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .click();
  await page.getByRole('button', { name: '変更履歴' }).click();
  await page.getByRole('button', { name: 'v1を表示', exact: true }).click();
  await page.locator('.media-line-item').filter({ hasText: 'ASP経由ライン' }).click();
  await expect(panel.getByLabel('入稿経路', { exact: true })).toHaveValue('asp');
  await expect(panel.getByLabel('入稿経路', { exact: true })).toBeDisabled();
  await page.screenshot({ path: '.context/screenshots/media-lines.png', fullPage: true });
});

test('メディアライン名の入力中も未保存状態を検知する', async ({ page }) => {
  await page.goto('/');
  await createCase(page, unique('ライン名の未保存保護'));
  await page.locator('.media-line-item').first().click();
  await page
    .locator('.inspector')
    .getByLabel('メディアライン名', { exact: true })
    .fill('入力中のメディアライン名');
  await expect(page.getByText('未保存の変更', { exact: true })).toBeVisible();
  const event = page.waitForEvent('dialog');
  const reload = page.evaluate(() => window.location.reload()).catch(() => null);
  const dialog = await event;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reload;
  await expect(
    page.locator('.inspector').getByLabel('メディアライン名', { exact: true }),
  ).toHaveValue('入力中のメディアライン名');
});

test('Web・電話・アプリ・LINEを1つの図で表示し編集と履歴を保持する', async ({ page }) => {
  const name = unique('全計測をひとつの図に統合');
  await page.goto('/');
  await page.getByRole('button', { name: '新しい案件を作成', exact: true }).click();
  const wizard = page.getByRole('dialog');
  await wizard.getByRole('textbox', { name: '案件名' }).fill(name);
  for (const label of ['アプリ計測', '電話計測', 'LINE友だち追加']) {
    await wizard.getByLabel(label, { exact: true }).check();
  }
  await wizard.getByRole('button', { name: '導線を生成する' }).click();
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  await expect(page.getByTestId('flow-canvas')).toHaveCount(1);
  await expect(page.locator('.route-tabs')).toHaveCount(0);
  for (const id of [
    'web-media',
    'web-lp',
    'web-thanks',
    'web-alladin',
    'phone-call-data-bank',
    'phone-call-tracker',
    'phone-call-center',
    'phone-records',
    'phone-batch',
    'app-placeholder',
    'line-friend-add',
  ]) {
    await expect(page.locator(`.react-flow__node[data-id="${id}"]`)).toBeVisible();
  }
  await expect(page.locator('.canvas-modes')).toContainText('アプリ計測');
  await expect(page.locator('.canvas-modes')).toContainText('LINE友だち追加');
  await page.locator('.react-flow__node[data-id="phone-records"]').click();
  const inspector = page.locator('.inspector');
  await inspector.getByLabel('注記', { exact: true }).fill('番号・LP URL・affnmsidの対応を確認');
  await page.locator('.graph-notes summary').click();
  await page.getByLabel('図の注記', { exact: true }).fill('共通LPから各経路に分岐する');
  await save(page, 'Web・電話・アプリ・LINEを同じ図に保存');
  const cases = await (await page.request.get('/api/cases')).json();
  const id = cases.cases.find((item: { name: string }) => item.name === name).id;
  let detail = await (await page.request.get(`/api/cases/${id}`)).json();
  const graph = detail.versions[0].snapshot.graph;
  expect(detail.versions[0].snapshot).not.toHaveProperty('routes');
  expect(graph.nodes.filter((node: { role: string }) => node.role === 'lp')).toHaveLength(1);
  expect(graph.nodes.filter((node: { role: string }) => node.role === 'alladin')).toHaveLength(1);
  expect(
    graph.edges.some(
      (edge: { source: string; target: string; kind: string }) =>
        edge.source === 'phone-call-data-bank' &&
        edge.target === 'phone-call-tracker' &&
        edge.kind === 'phone',
    ),
  ).toBe(true);
  expect(
    graph.edges.some(
      (edge: { source: string; target: string }) =>
        edge.source === 'phone-batch' && edge.target === 'web-alladin',
    ),
  ).toBe(true);
  expect(
    graph.edges.some(
      (edge: { source: string; target: string }) =>
        edge.source === 'web-lp' && edge.target === 'line-friend-add',
    ),
  ).toBe(true);
  expect(
    graph.edges.some(
      (edge: { source: string; target: string }) =>
        edge.source === 'app-placeholder' || edge.target === 'app-placeholder',
    ),
  ).toBe(false);
  await page.reload();
  await page
    .locator('.case-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .click();
  await page.locator('.react-flow__node[data-id="phone-records"]').click();
  await expect(inspector.getByLabel('注記', { exact: true })).toHaveValue(
    '番号・LP URL・affnmsidの対応を確認',
  );
  await page.locator('.configuration').getByLabel('電話計測', { exact: true }).uncheck();
  await page.getByRole('button', { name: '変更をプレビュー', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('番号・LP URL・affnmsidの対応を確認');
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click();
  await expect(page.locator('[data-id="phone-records"]')).toBeVisible();
  await page.getByRole('button', { name: '変更をプレビュー', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '変更を適用する' }).click();
  await expect(page.locator('[data-id="phone-records"]')).toHaveCount(0);
  await save(page, '電話計測のみ対象から外す');
  detail = await (await page.request.get(`/api/cases/${id}`)).json();
  expect(
    detail.versions[1].snapshot.graph.nodes.some(
      (node: { id: string; note: string }) =>
        node.id === 'phone-records' && node.note === '番号・LP URL・affnmsidの対応を確認',
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '変更履歴', exact: false }).click();
  await page.getByRole('button', { name: 'v1を表示', exact: true }).click();
  await expect(page.locator('[data-id="phone-call-data-bank"]')).toBeVisible();
  await expect(page.locator('[data-id="app-placeholder"]')).toBeVisible();
  await expect(page.locator('[data-id="line-friend-add"]')).toBeVisible();
  await page.getByRole('button', { name: 'キャンバスを広く表示' }).click();
  await expect(page.locator('[data-id="phone-records"]')).toBeVisible();
  await page.screenshot({ path: '.context/screenshots/unified-tracking.png', fullPage: true });
});

test('旧形式の保存版を1つの図で閲覧し、全体の注記と保存内容を保持する', async ({ page }) => {
  await page.goto('/');
  const name = unique('旧V2保存版の統合表示');
  const snapshot = generateV2Snapshot({ postback: false, measurements: ['web', 'app', 'phone'] });
  snapshot.routes[0].note = '旧Web図の注記を表示する';
  snapshot.routes[1].note = '旧アプリ図の確認事項も保持する';
  const now = new Date().toISOString();
  const id = crypto.randomUUID(),
    versionId = crypto.randomUUID(),
    draftId = crypto.randomUUID();
  const item = {
    id,
    name,
    registration: 'existing',
    headVersionId: versionId,
    createdAt: now,
    updatedAt: now,
  };
  const version = {
    id: versionId,
    caseId: id,
    number: 1,
    baseVersionId: null,
    snapshot,
    reason: '旧形式で保存した図',
    createdAt: now,
    status: 'unresolved',
  };
  const draft = {
    id: draftId,
    caseId: id,
    baseVersionId: versionId,
    expectedHeadId: versionId,
    revision: 1,
    snapshot,
    reason: '',
    updatedAt: now,
  };
  const original = JSON.stringify(version);
  const database = new DatabaseSync(resolve('.context/e2e-data/anken-wires.sqlite'));
  try {
    database.exec('PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;');
    database.prepare('INSERT INTO cases(id,data) VALUES (?,?)').run(id, JSON.stringify(item));
    database
      .prepare('INSERT INTO versions(id,case_id,number,data) VALUES (?,?,?,?)')
      .run(versionId, id, 1, original);
    database
      .prepare('INSERT INTO drafts(id,case_id,data) VALUES (?,?,?)')
      .run(draftId, id, JSON.stringify(draft));
    database.exec('COMMIT;');
  } finally {
    database.close();
  }
  await page.reload();
  await page
    .locator('.case-card')
    .filter({ has: page.getByRole('heading', { name, exact: true }) })
    .click();
  await page.getByRole('button', { name: '変更履歴', exact: false }).click();
  await page.getByRole('button', { name: 'v1を表示', exact: true }).click();
  await expect(page.getByTestId('flow-canvas')).toHaveCount(1);
  await expect(page.locator('.route-tabs')).toHaveCount(0);
  for (const node of ['web-lp', 'app-placeholder', 'phone-placeholder']) {
    await expect(page.locator(`.react-flow__node[data-id="${node}"]`)).toBeVisible();
  }
  await expect(page.locator('[data-id="phone-call-data-bank"]')).toHaveCount(0);
  await page.locator('.graph-notes summary').click();
  const note = page.getByLabel('図の注記', { exact: true });
  await expect(note).toHaveValue(/旧Web図の注記を表示する/);
  await expect(note).toHaveValue(/旧アプリ図の確認事項も保持する/);
  await expect(note).toBeDisabled();
  const check = new DatabaseSync(resolve('.context/e2e-data/anken-wires.sqlite'));
  try {
    expect(
      (check.prepare('SELECT data FROM versions WHERE id = ?').get(versionId) as { data: string })
        .data,
    ).toBe(original);
  } finally {
    check.close();
  }
});
