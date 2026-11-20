import { BrowserProvider, getAddress } from 'ethers';
import { DOMAIN } from '../../shared/protocol.js';

export const hasWallet = () => typeof window !== 'undefined' && !!window.ethereum;

function friendly(e) {
  const code = e?.code ?? e?.info?.error?.code ?? e?.error?.code;
  if (code === 4001 || code === 'ACTION_REJECTED') return new Error('You cancelled the request in your wallet.');
  if (code === -32002) return new Error('Your wallet already has a request open. Open the wallet to finish or cancel it.');
  return new Error(e?.shortMessage || e?.message || 'The wallet returned an error.');
}

export async function currentAccount() {
  if (!hasWallet()) return null;
  try {
    const [a] = await window.ethereum.request({ method: 'eth_accounts' });
    return a ? getAddress(a) : null;
  } catch {
    return null;
  }
}

export async function connectWallet() {
  if (!hasWallet()) {
    throw new Error(
      "No wallet found. Install a browser wallet such as MetaMask, or open this page in your wallet app's built-in browser.",
    );
  }
  try {
    const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (!a) throw new Error('The wallet did not share an account.');
    return getAddress(a);
  } catch (e) {
    throw friendly(e);
  }
}

export function onAccountChange(callback) {
  if (!hasWallet() || typeof window.ethereum.on !== 'function') return () => {};
  const handler = (accounts) => callback(accounts && accounts[0] ? getAddress(accounts[0]) : null);
  window.ethereum.on('accountsChanged', handler);
  return () => window.ethereum.removeListener?.('accountsChanged', handler);
}

// Ask the wallet to sign typed data. The wallet shows every field in plain text,
// so the person sees exactly what they are agreeing to. This is not a
// transaction: it costs nothing and touches no funds.
export async function signTyped(expectedAddress, types, message) {
  try {
    const signer = await new BrowserProvider(window.ethereum).getSigner();
    const address = getAddress(await signer.getAddress());
    if (address !== expectedAddress) {
      throw new Error('Your wallet switched to a different account. Reconnect and try again.');
    }
    return await signer.signTypedData(DOMAIN, types, message);
  } catch (e) {
    throw friendly(e);
  }
}
