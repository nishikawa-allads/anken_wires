import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ApiError, type Store } from './store';

const answersSchema = z
  .object({
    postback: z.boolean(),
    measurements: z
      .array(z.enum(['web', 'app', 'phone', 'line']))
      .min(1)
      .max(4)
      .refine((items) => new Set(items).size === items.length),
  })
  .strict();
const createSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    registration: z.enum(['new', 'existing']),
    answers: answersSchema,
  })
  .strict();
const draftSchema = z
  .object({
    baseVersionId: z.string().min(1).nullable(),
    expectedHeadId: z.string().min(1).nullable(),
    replaceRevision: z.number().int().positive().optional(),
  })
  .strict();
const updateSchema = z
  .object({
    revision: z.number().int().positive(),
    snapshot: z.unknown().refine((value) => value !== undefined),
    reason: z.string().max(2000),
  })
  .strict();
const saveSchema = z.object({ revision: z.number().int().positive() }).strict();

function parsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ApiError(400, '入力内容を確認してください。必須項目・文字数・選択内容が不正です。');
  return result.data;
}

export function createApp(
  store: Store,
  options: { staticDir?: string; developmentOrigin?: string } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  const localOnly: RequestHandler = (req, _res, next) => {
    const host = req.get('host');
    if (host) {
      let hostname: string;
      try {
        hostname = new URL(`http://${host}`).hostname;
      } catch {
        return next(new ApiError(403, 'このホストからは利用できません。'));
      }
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(hostname))
        return next(new ApiError(403, 'このアプリはローカル環境で利用してください。'));
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      const ownOrigin = `${req.protocol}://${host}`;
      const developmentOrigin = options.developmentOrigin ?? 'http://127.0.0.1:5173';
      const allowed = [
        ownOrigin,
        developmentOrigin,
        developmentOrigin.replace('127.0.0.1', 'localhost'),
      ];
      if (!allowed.includes(origin))
        return next(new ApiError(403, '異なるサイトからの更新は許可されていません。'));
    }
    if (!req.is('application/json')) return next(new ApiError(415, 'JSON形式で送信してください。'));
    next();
  };
  app.use('/api', localOnly, express.json({ limit: '2mb' }));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/cases', (_req, res) => res.json({ cases: store.listCases() }));
  app.post('/api/cases', (req, res) =>
    res.status(201).json(store.createCase(parsed(createSchema, req.body))),
  );
  app.get('/api/cases/:id', (req, res) => res.json(store.detail(req.params.id)));
  app.post('/api/cases/:id/draft', (req, res) =>
    res.json({ draft: store.startDraft(req.params.id, parsed(draftSchema, req.body)) }),
  );
  app.put('/api/drafts/:id', (req, res) =>
    res.json({ draft: store.updateDraft(req.params.id, parsed(updateSchema, req.body)) }),
  );
  app.post('/api/drafts/:id/versions', (req, res) =>
    res.status(201).json(store.saveVersion(req.params.id, parsed(saveSchema, req.body).revision)),
  );
  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'APIが見つかりません。')));

  const staticDir = resolve(options.staticDir ?? 'dist');
  if (existsSync(resolve(staticDir, 'index.html'))) {
    app.use(express.static(staticDir));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(staticDir, 'index.html')));
  }
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ApiError)
      return void res.status(error.status).json({ error: error.message });
    if (error?.type === 'entity.parse.failed')
      return void res.status(400).json({ error: 'JSON形式を読み取れません。' });
    if (error?.type === 'entity.too.large')
      return void res.status(413).json({ error: '導線データが大きすぎます。' });
    console.error(error);
    res
      .status(500)
      .json({ error: '保存処理でエラーが発生しました。下書きを保持して再度お試しください。' });
  };
  app.use(errorHandler);
  return app;
}
