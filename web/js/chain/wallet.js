// Wallets through NEAR Connect (@hot-labs/near-connect, vendored in web/vendor/near-connect.js).
// The connector is loaded only when somebody wants a wallet, or had one connected before.

import { NETWORK, plain, vendor } from './near.js';

let connector = null;
let loading = null;
let account = null;
let changed = () => {};

/** Called with the account id (or null) whenever the wallet signs in or out. */
export function onWalletChange(callback) {
  changed = callback;
}

export const walletAccount = () => account;

function load() {
  if (connector) return Promise.resolve(connector);
  if (!loading) {
    loading = (async () => {
      const { NearConnector } = await vendor('near-connect');
      const made = new NearConnector({
        network: NETWORK,
        features: { signAndSendTransaction: true, testnet: true },
      });
      made.on('wallet:signIn', (event) => {
        const first = event && event.accounts && event.accounts[0];
        account = first ? first.accountId : account;
        changed(account);
      });
      made.on('wallet:signOut', () => {
        account = null;
        changed(null);
      });
      connector = made;
      return made;
    })().catch((error) => {
      loading = null;
      console.warn('[wallet] could not load NEAR Connect', error);
      throw plain('The wallet picker could not load. Check the connection and try again.');
    });
  }
  return loading;
}

/** The wallet picker as it stands: the wallets that can sign on testnet. */
export async function walletList() {
  const made = await load();
  await made.whenManifestLoaded.catch(() => {});
  return made.availableWallets.map((wallet) => wallet.manifest.name);
}

/** Restores a wallet connected in an earlier visit. Resolves the account id or null. */
export async function restoreWallet() {
  const made = await load();
  try {
    const { accounts } = await made.getConnectedWallet();
    account = (accounts && accounts[0] && accounts[0].accountId) || null;
  } catch {
    account = null;
  }
  return account;
}

/** Opens the picker. Resolves the account id, or null when the person closes it. */
export async function connectWallet() {
  const made = await load();
  try {
    const wallet = await made.connect();
    if (!account) {
      const accounts = await wallet.getAccounts().catch(() => []);
      account = (accounts && accounts[0] && accounts[0].accountId) || null;
    }
    return account;
  } catch (error) {
    if (/reject|cancel|closed/i.test(String(error && error.message))) return null;
    console.warn('[wallet] connect failed', error);
    throw plain('The wallet did not connect. Please try again.');
  }
}

export async function disconnectWallet() {
  if (!connector) return;
  try {
    await connector.disconnect();
  } catch (error) {
    console.warn('[wallet] disconnect', error);
  }
  account = null;
}

/** The signer `tx.send` expects: the wallet asks the person, then sends. */
export const walletSigner = {
  async send(receiverId, actions) {
    const made = await load();
    const wallet = await made.wallet();
    return wallet.signAndSendTransaction({ signerId: account || undefined, receiverId, actions, network: NETWORK });
  },
};
