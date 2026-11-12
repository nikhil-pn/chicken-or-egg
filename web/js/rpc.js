// Read-only NEAR JSON-RPC from the browser. No wallet, no keys, no signing.
//
// Every call is a `query`. Three public nodes are used, in order. When the node in use
// fails (HTTP 429 or 5xx, no answer, a blocked request), the next node is asked at once;
// when it is merely slow, the next node is asked as well after a short wait, and the
// first good answer wins. The page then stays on the node that answered.

/**
 * Public testnet nodes that allow calls from a web page (CORS), checked from a browser
 * on 12 Nov 2026. The last one answers but is slow (3 to 14 seconds): a last resort.
 */
export const ENDPOINTS = [
  'https://test.rpc.fastnear.com',
  'https://near-testnet.drpc.org',
  'https://rpc.testnet.near.org',
];

const TIMEOUT_MS = 10000;
const HEDGE_MS = 2500; // a node this slow gets company: the next node is asked too
const BACK_TO_FIRST_MS = 120000; // after two minutes the first node gets another chance
const AT_ONCE = 3; // calls in flight at the same time, to stay well under rate limits

class ContractError extends Error {}

/** The account, or the contract on it, does not exist yet: the game has not been deployed. */
class MissingError extends ContractError {
  constructor(message) {
    super(message);
    this.missing = true;
  }
}

const NOT_THERE = /UNKNOWN_ACCOUNT|CodeDoesNotExist|not initialized/i;

const toBase64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

async function post(url, params, id) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'query', params }),
      signal: stop.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`); // 429, 5xx and the rest: the other node is asked
    const body = await res.json();
    if (body.error) {
      const cause = (body.error.cause && body.error.cause.name) || body.error.message || 'RPC error';
      // The node understood the question and said no: asking another node will not help.
      if (NOT_THERE.test(cause)) throw new MissingError(cause);
      if (body.error.name === 'HANDLER_ERROR' && cause !== 'UNKNOWN_BLOCK') throw new ContractError(cause);
      throw new Error(cause);
    }
    if (!body.result) throw new Error('Empty answer');
    if (body.result.error) {
      const text = String(body.result.error);
      throw NOT_THERE.test(text) ? new MissingError(text) : new ContractError(text);
    }
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/** Lets at most `max` jobs run at the same time; the rest wait in line. */
function line(max) {
  let running = 0;
  const waiting = [];
  const next = () => {
    if (running >= max || !waiting.length) return;
    running += 1;
    waiting.shift()();
  };
  return async (job) => {
    await new Promise((go) => { waiting.push(go); next(); });
    try { return await job(); } finally { running -= 1; next(); }
  };
}

export function createRpc(endpoints = ENDPOINTS) {
  const inLine = line(AT_ONCE);
  let current = 0;
  let switchedAt = 0;
  let calls = 0;

  function ask(params) {
    if (current !== 0 && Date.now() - switchedAt > BACK_TO_FIRST_MS) current = 0;
    const order = endpoints.map((_, step) => (current + step) % endpoints.length);
    return new Promise((resolve, reject) => {
      let done = false;
      let started = 0;
      let failed = 0;
      const timers = [];
      const finish = (then, value) => {
        done = true;
        timers.forEach(clearTimeout);
        then(value);
      };
      const start = (k) => {
        if (done || k >= order.length || k < started) return;
        started = k + 1;
        const index = order[k];
        post(endpoints[index], params, ++calls).then((result) => {
          if (done) return;
          if (index !== current) {
            current = index;
            switchedAt = Date.now();
          }
          finish(resolve, result);
        }, (error) => {
          if (done) return;
          if (error instanceof ContractError) { finish(reject, error); return; } // another node would say the same
          if (++failed === order.length) finish(reject, error);
          else start(k + 1);
        });
        timers.push(setTimeout(() => start(k + 1), HEDGE_MS));
      };
      start(0);
    });
  }

  const query = (params) => inLine(() => ask(params));

  return {
    fixture: false,

    /** Calls a view method and returns its JSON answer. */
    async view(account, method, args = {}) {
      const result = await query({
        request_type: 'call_function',
        finality: 'final',
        account_id: account,
        method_name: method,
        args_base64: toBase64(JSON.stringify(args)),
      });
      return JSON.parse(new TextDecoder().decode(new Uint8Array(result.result)));
    },

    /** Access keys on an account: how many, and how many of them are full access. */
    async keys(account) {
      const result = await query({ request_type: 'view_access_key_list', finality: 'final', account_id: account });
      const list = result.keys || [];
      return { total: list.length, full: list.filter((k) => k.access_key.permission === 'FullAccess').length };
    },

    /** Which node is answering right now. */
    info: () => ({ endpoint: endpoints[current], host: new URL(endpoints[current]).host, backup: current !== 0 }),
  };
}
