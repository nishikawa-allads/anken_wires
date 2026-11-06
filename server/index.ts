import { resolve } from 'node:path';
import { createStore } from './store';
import { createApp } from './app';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORTには1〜65535の整数を指定してください。');
const store = createStore(resolve(process.env.DATA_DIR ?? 'data', 'anken-wires.sqlite'));
const app = createApp(store, {
  developmentOrigin: `http://127.0.0.1:${process.env.WEB_PORT ?? 5173}`,
});
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`案件導線管理 API: http://127.0.0.1:${port}`),
);
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
