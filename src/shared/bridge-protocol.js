/**
 * Komunikace izolovaný svět ↔ MAIN world přes CustomEvent na `document`.
 *
 * - Data se posílají jako řetězec JSON (objekty v `detail` mezi světy spolehlivě neprojdou).
 * - MAIN world vygeneruje při document_start náhodný token a pošle ho zprávou `hello`.
 *   Izolovaný svět přijme jen první `hello`. Obě strany pak ignorují zprávy bez platného tokenu.
 * - Povolené jsou jen typy zpráv z pevného seznamu a všechna data se validují na místě použití.
 *
 * Token chrání před kolizí s jinými skripty, ne před cíleným útokem stránky (ta přehrávač ovládá stejně).
 * Data z mostu se proto nikdy neposílají do service workeru; SW bere jen ID videa z adresy stránky.
 */
export const EVT_TO_MAIN = 'ytk:i2m';
export const EVT_TO_ISOLATED = 'ytk:m2i';
export const EVT_PING = 'ytk:ping';
const MAX_DETAIL = 100_000;

function send(eventName, message) {
  document.dispatchEvent(new CustomEvent(eventName, { detail: JSON.stringify(message) }));
}

export function parseMessage(event) {
  if (typeof event.detail !== 'string' || event.detail.length > MAX_DETAIL) return null;
  try {
    const message = JSON.parse(event.detail);
    return message && typeof message === 'object' && typeof message.type === 'string' ? message : null;
  } catch {
    return null;
  }
}

function randomToken() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** MAIN world: obsluhuje příkazy `handlers[type](data)` (synchronní funkce). */
export function createMainEndpoint(handlers) {
  const token = randomToken();
  const hello = () => send(EVT_TO_ISOLATED, { type: 'hello', token });

  document.addEventListener(EVT_PING, hello);
  document.addEventListener(EVT_TO_MAIN, (event) => {
    const message = parseMessage(event);
    if (!message || message.token !== token) return;
    if (!Object.hasOwn(handlers, message.type)) return;
    let result = null;
    let error = null;
    try {
      result = handlers[message.type](message.data && typeof message.data === 'object' ? message.data : {}) ?? null;
    } catch (err) {
      error = String(err?.message || err);
    }
    send(EVT_TO_ISOLATED, { type: 'reply', token, id: message.id, result, error });
  });
  hello();

  return {
    notify(eventName, data) {
      send(EVT_TO_ISOLATED, { type: 'notify', token, event: eventName, data });
    },
  };
}

/** Izolovaný svět: `call(type, data)` → Promise s výsledkem z MAIN worldu. */
export function createIsolatedEndpoint() {
  let token = null;
  let seq = 0;
  const pending = new Map();
  const listeners = new Map();
  let markReady;
  const ready = new Promise((resolve) => {
    markReady = resolve;
  });

  document.addEventListener(EVT_TO_ISOLATED, (event) => {
    const message = parseMessage(event);
    if (!message) return;
    if (message.type === 'hello') {
      if (!token && typeof message.token === 'string' && message.token.length >= 16) {
        token = message.token;
        markReady();
      }
      return;
    }
    if (!token || message.token !== token) return;
    if (message.type === 'reply') {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error));
      else entry.resolve(message.result);
    } else if (message.type === 'notify' && typeof message.event === 'string') {
      for (const listener of listeners.get(message.event) ?? []) listener(message.data);
    }
  });
  document.dispatchEvent(new CustomEvent(EVT_PING));

  async function call(type, data = {}, timeout = 3000) {
    let readyTimer;
    const notReady = new Promise((_, reject) => {
      readyTimer = setTimeout(() => reject(new Error('main-world-unavailable')), timeout);
    });
    try {
      await Promise.race([ready, notReady]);
    } finally {
      clearTimeout(readyTimer);
    }
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('timeout'));
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      send(EVT_TO_MAIN, { type, token, id, data });
    });
  }

  function on(eventName, listener) {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(listener);
  }

  return { ready, call, on };
}
