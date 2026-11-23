/** Most MAIN ↔ izolovaný svět: simulace `document` s EventTarget (oba světy sdílí DOM události). */
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = new EventTarget();
globalThis.CustomEvent ??= class extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail ?? null;
  }
};

const { createIsolatedEndpoint, createMainEndpoint, EVT_TO_ISOLATED, EVT_TO_MAIN } = await import(
  '../src/shared/bridge-protocol.js'
);

test('volání z izolovaného světa do MAIN a notifikace zpět', async () => {
  const isolated = createIsolatedEndpoint();
  const main = createMainEndpoint({ add: ({ a, b }) => a + b, fail: () => { throw new Error('boom'); } });
  assert.equal(await isolated.call('add', { a: 2, b: 3 }), 5);
  await assert.rejects(isolated.call('fail'), /boom/);
  await assert.rejects(isolated.call('neexistuje', {}, 100), /timeout/);

  const received = [];
  isolated.on('codec', (data) => received.push(data));
  main.notify('codec', { video: 'video/webm; codecs="vp9"' });
  assert.deepEqual(received, [{ video: 'video/webm; codecs="vp9"' }]);
});

test('zprávy bez platného tokenu se ignorují', async () => {
  const calls = [];
  createMainEndpoint({ spy: () => calls.push(1) });
  globalThis.document.dispatchEvent(new CustomEvent(EVT_TO_MAIN, { detail: JSON.stringify({ type: 'spy', token: 'cizi', id: 1 }) }));
  globalThis.document.dispatchEvent(new CustomEvent(EVT_TO_MAIN, { detail: { type: 'spy' } }));
  globalThis.document.dispatchEvent(new CustomEvent(EVT_TO_MAIN, { detail: '{nejson' }));
  assert.equal(calls.length, 0);

  // Podvržená notifikace s cizím tokenem se do izolovaného světa nedostane.
  const isolated = createIsolatedEndpoint();
  await isolated.ready;
  const received = [];
  isolated.on('codec', (data) => received.push(data));
  globalThis.document.dispatchEvent(
    new CustomEvent(EVT_TO_ISOLATED, { detail: JSON.stringify({ type: 'notify', token: 'x'.repeat(32), event: 'codec', data: 1 }) }),
  );
  assert.deepEqual(received, []);
});
