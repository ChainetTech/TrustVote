import { useCallback, useEffect, useState } from 'react';
import { api, setServerTime } from './api.js';
import { connectWallet, currentAccount, onAccountChange } from './wallet.js';
import { shortAddr } from './format.js';
import Home from './pages/Home.jsx';
import NewPoll from './pages/NewPoll.jsx';
import PollPage from './pages/PollPage.jsx';
import Verify from './pages/Verify.jsx';

function useRoute() {
  const read = () => (window.location.hash || '#/').slice(1);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route.split('/').filter(Boolean);
}

export default function App() {
  const [section, id] = useRoute();
  const [account, setAccount] = useState(null);
  const [info, setInfo] = useState(null);
  const [walletError, setWalletError] = useState('');

  useEffect(() => {
    currentAccount().then(setAccount);
    return onAccountChange(setAccount);
  }, []);

  useEffect(() => {
    api
      .info()
      .then((i) => {
        setServerTime(i.now);
        setInfo(i);
      })
      .catch(() => {});
  }, []);

  // Returns the connected address, asking the wallet if needed. Throws on failure.
  const connect = useCallback(async () => {
    const address = await connectWallet();
    setAccount(address);
    setWalletError('');
    return address;
  }, []);

  const onConnectClick = async () => {
    try {
      await connect();
    } catch (e) {
      setWalletError(e.message);
    }
  };

  let page;
  if (section === 'new') page = <NewPoll account={account} connect={connect} />;
  else if (section === 'poll' && id) page = <PollPage key={id} id={id} account={account} connect={connect} />;
  else if (section === 'verify') page = <Verify info={info} />;
  else page = <Home />;

  const nav = (href, label, active) => (
    <a href={href} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined}>
      {label}
    </a>
  );

  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <a href="#/" className="brand" aria-label="TrustVote home">
            <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="var(--accent)" />
              <path d="M9 16.5l4.5 4.5L23 11" fill="none" stroke="var(--accent-ink)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>TrustVote</span>
          </a>
          <nav className="nav">
            {nav('#/', 'Polls', !section || section === 'poll')}
            {nav('#/new', 'New poll', section === 'new')}
            {nav('#/verify', 'Verify', section === 'verify')}
          </nav>
          {account ? (
            <span className="wallet-chip" title={account}>
              <span className="dot" aria-hidden="true" />
              {shortAddr(account)}
            </span>
          ) : (
            <button type="button" className="btn small" onClick={onConnectClick}>
              Connect wallet
            </button>
          )}
        </div>
      </header>
      {walletError && (
        <div className="wrap">
          <p className="notice bad" role="alert">
            {walletError}
          </p>
        </div>
      )}
      <main className="wrap main">{page}</main>
      <footer className="wrap footer">
        Every poll and vote is signed by a wallet and kept in a public log that can only be added to.{' '}
        <a href="#/verify">Check the count yourself →</a>
      </footer>
    </>
  );
}
