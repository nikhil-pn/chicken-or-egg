// Builds the game's transactions and reads their results. Both signers (a wallet through
// NEAR Connect, or the guest key in this browser) take the same action objects and return
// the same kind of outcome, so everything here is shared.

import { ONE_YOCTO, TGAS, humane, plain } from './near.js';

/** A FunctionCall action in NEAR Connect's format (the guest signer converts it). */
export const call = (methodName, args, gasTgas, deposit = 0n) => ({
  type: 'FunctionCall',
  params: { methodName, args, gas: String(BigInt(gasTgas) * TGAS), deposit: String(deposit) },
});

/** The game's four writes. Gas: 100 Tgas where a cross-contract call follows, as our scripts use. */
export const actions = {
  claimStarter: (fee) => call('claim_starter', {}, 100, BigInt(fee)),
  join: (fee) => call('join', {}, 30, BigInt(fee)),
  roostFromWallet: (coop, amount) =>
    call('ft_transfer_call', { receiver_id: coop, amount: String(amount), msg: 'roost' }, 100, ONE_YOCTO),
  roostFromNest: (side, amount) => call('roost', { side, amount: String(amount) }, 10),
  claim: () => call('claim', {}, 100),
};

/** The transaction hash of an outcome, whichever shape the signer returned. */
export function hashOf(outcome) {
  return (outcome && ((outcome.transaction && outcome.transaction.hash)
    || (outcome.transaction_outcome && outcome.transaction_outcome.id)
    || outcome.hash)) || null;
}

/** The first failure in the transaction or in any of its receipts, as text. */
export function failureOf(outcome) {
  if (!outcome) return null;
  const statuses = [outcome.status, ...(outcome.receipts_outcome || []).map((r) => r.outcome && r.outcome.status)];
  for (const status of statuses) {
    if (status && typeof status === 'object' && status.Failure) return describe(status.Failure);
  }
  return null;
}

function describe(failure) {
  const text = JSON.stringify(failure);
  const panic = /Smart contract panicked: ([^"\\]+)/.exec(text);
  if (panic) return panic[1];
  const execution = /"ExecutionError":"([^"]+)"/.exec(text);
  if (execution) return execution[1];
  return text;
}

/** The JSON value the transaction returned, if it returned one. */
export function returnOf(outcome) {
  const value = outcome && outcome.status && outcome.status.SuccessValue;
  if (!value) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

/**
 * Sends one transaction with `signer` and checks it. A failure anywhere in it, including a
 * refused roost that the coin quietly refunded, is thrown as a short sentence.
 */
export async function send(signer, receiverId, action) {
  let outcome;
  try {
    outcome = await signer.send(receiverId, [action]);
  } catch (error) {
    console.warn('[chain] send failed', error);
    throw humane(error);
  }
  const hash = hashOf(outcome);
  const failure = failureOf(outcome);
  if (failure) {
    console.warn('[chain] transaction failed', hash, failure);
    const error = humane(failure, 'The transaction failed on chain.');
    error.tx = hash;
    throw error;
  }
  if (action.params.methodName === 'ft_transfer_call') {
    const used = returnOf(outcome);
    if (used !== undefined && BigInt(used) !== BigInt(action.params.args.amount)) {
      const error = plain('The coop refused the coins; they went back to your wallet.');
      error.tx = hash;
      throw error;
    }
  }
  return { hash, outcome };
}
