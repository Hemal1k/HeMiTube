/**
 * Minimální klient Chrome DevTools Protocol přes --remote-debugging-pipe (fd 3 = zápis do prohlížeče,
 * fd 4 = čtení). Pipe je potřeba pro Extensions.loadUnpacked. Bez závislostí.
 */
import { spawn } from 'node:child_process';

export class CDP {
  constructor(writable, readable) {
    this.writable = writable;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    let buffer = '';
    readable.setEncoding('utf8');
    // Prohlížeč se ukončil → čekající volání skončí chybou místo visení.
    const onClose = () => {
      this.closed = true;
      for (const { reject, method, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(`${method}: prohlížeč byl ukončen`));
      }
      this.pending.clear();
    };
    readable.on('end', onClose);
    readable.on('close', onClose);
    readable.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\0')) >= 0) {
        const raw = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        this.#dispatch(JSON.parse(raw));
      }
    });
  }

  #dispatch(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve, reject, method, timer } = this.pending.get(message.id);
      clearTimeout(timer);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${method}: ${message.error.message}`));
      else resolve(message.result);
      return;
    }
    for (const listener of this.listeners) listener(message);
  }

  send(method, params = {}, sessionId, timeout = 60000) {
    if (this.closed) return Promise.reject(new Error(`${method}: prohlížeč byl ukončen`));
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      // Bez limitu by test při ukončeném prohlížeči visel donekonečna.
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: bez odpovědi ${timeout} ms`));
      }, timeout);
      this.pending.set(id, { resolve, reject, method, timer });
      this.writable.write(`${JSON.stringify(message)}\0`);
    });
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export function launch(executable, args) {
  const child = spawn(executable, ['--remote-debugging-pipe', ...args], {
    stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'],
    windowsHide: false,
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  return { child, cdp: new CDP(child.stdio[3], child.stdio[4]), getStderr: () => stderr };
}

/** Obal nad jednou připojenou stránkou / workerem (flatten session). */
export class Session {
  constructor(cdp, sessionId) {
    this.cdp = cdp;
    this.sessionId = sessionId;
  }

  send(method, params) {
    return this.cdp.send(method, params, this.sessionId);
  }

  async evaluate(expression, { timeout = 30000 } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout,
    });
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`evaluate: ${description}`);
    }
    return result.result.value;
  }

  /** Opakuje výraz, dokud nevrátí pravdivou hodnotu. */
  async waitFor(expression, { timeout = 20000, interval = 250, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(expression);
        if (last) return last;
      } catch (error) {
        last = error.message; // stránka se může zrovna přenačítat
      }
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    throw new Error(`Timeout (${timeout} ms): ${label} → ${JSON.stringify(last)}`);
  }
}
