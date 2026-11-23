import { Buffer } from 'buffer';
window.Buffer = window.Buffer || Buffer;
import * as C from './chain.js';
import { PublicKey } from '@solana/web3.js';

const $ = id => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// ---------- būsena ----------
let S = store.get('ml-settings', { net: 'devnet', rpc: {}, solUsd: 0, jwt: '' });
let wallet = null, conn = null, logoFile = null, liveTimer = null, liveCoin = null;
const draftKey = () => 'ml-draft-' + S.net;
let draft = store.get(draftKey(), {});
let coins = store.get('ml-coins', []);
const FORM = ['name', 'symbol', 'desc', 'website', 'twitter', 'telegram', 'uri', 'supply', 'pct', 'mcap', 'fee'];
const CHECKS = ['anti', 'lock', 'mutable'];

// ---------- formatai ----------
const usd = v => { if (!isFinite(v)) return '–'; const a = Math.abs(v); if (a >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (a >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M'; if (a >= 1e3) return '$' + (v / 1e3).toFixed(a >= 1e4 ? 1 : 2) + 'K'; return '$' + v.toFixed(2); };
const sol = v => (v >= 100 ? v.toFixed(1) : v >= 1 ? v.toFixed(3) : v.toFixed(4)) + ' SOL';
const tok = v => v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : v.toFixed(0);
const tiny = v => v ? v.toExponential(3).replace('e', '×10^') : '0';
const short = a => a ? a.slice(0, 4) + '…' + a.slice(-4) : '';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kv = rows => rows.map(([a, b]) => `<div class="kv"><span>${a}</span><span>${b}</span></div>`).join('');

function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, err ? 9000 : 3500);
}
async function busy(btn, fn) {
  const txt = btn.textContent; btn.disabled = true; btn.textContent = '…';
  try { await fn(); } catch (e) { console.error(e); toast(e.message || String(e), true); }
  finally { btn.disabled = false; btn.textContent = txt; }
}
function saveSettings() { store.set('ml-settings', S); }
function saveDraft() { store.set(draftKey(), draft); }

// ---------- tinklas ----------
function rpcUrl() { return (S.rpc[S.net] || '').trim() || C.DEFAULT_RPC[S.net]; }
function setNet(n) {
  S.net = n; saveSettings();
  conn = C.makeConnection(rpcUrl());
  draft = store.get(draftKey(), {});
  document.querySelectorAll('[data-net]').forEach(b => b.classList.toggle('on', b.dataset.net === n));
  $('rpc').value = S.rpc[n] || '';
  $('netWarn').textContent = n === 'mainnet' ? 'MAINNET – tikri pinigai' : 'DEVNET – testinis tinklas, pinigai netikri';
  $('netWarn').className = 'banner ' + n;
  $('airdrop').hidden = n !== 'devnet';
  refreshBal(); renderSteps(); renderMine();
}
document.querySelectorAll('[data-net]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.net === 'mainnet' && S.net !== 'mainnet') toast('Perjungta į MAINNET – čia naudojami tikri SOL.');
  setNet(b.dataset.net);
}));
$('rpc').addEventListener('change', () => { S.rpc[S.net] = $('rpc').value.trim(); saveSettings(); conn = C.makeConnection(rpcUrl()); refreshBal(); });
$('solUsd').addEventListener('input', () => { S.solUsd = +$('solUsd').value || 0; saveSettings(); calc(); });

// ---------- wallet ----------
async function refreshBal() {
  if (!wallet || !conn) return;
  try { const b = await C.getSolBalance(conn, wallet); $('bal').textContent = sol(b) + (S.solUsd ? ' (' + usd(b * S.solUsd) + ')' : ''); wallet.bal = b; }
  catch (e) { $('bal').textContent = 'nepavyko (RPC?)'; }
}
function showWallet() {
  $('connect').hidden = true; $('walletInfo').hidden = false;
  $('addr').textContent = short(wallet.toBase58()); refreshBal();
}
$('connect').addEventListener('click', e => busy(e.target, async () => { wallet = await C.connectWallet(); showWallet(); }));
$('refreshBal').addEventListener('click', refreshBal);
$('airdrop').addEventListener('click', e => busy(e.target, async () => {
  try { await C.airdrop(conn, wallet); toast('Gavai 1 devnet SOL'); }
  catch { throw new Error('Devnet airdrop dabar ribojamas. Pabandyk faucet.solana.com (įklijuok savo adresą).'); }
  refreshBal();
}));
$('addr').addEventListener('click', () => wallet && navigator.clipboard?.writeText(wallet.toBase58()).then(() => toast('Adresas nukopijuotas')));
$('openPhantom').href = 'https://phantom.app/ul/browse/' + encodeURIComponent(location.href) + '?ref=' + encodeURIComponent(location.origin);

// ---------- forma ----------
function loadForm() {
  const f = store.get('ml-form', {});
  FORM.forEach(k => { if (f[k] !== undefined) $(k).value = f[k]; });
  CHECKS.forEach(k => { if (f[k] !== undefined) $(k).checked = f[k]; });
  $('jwt').value = S.jwt || '';
}
function saveForm() {
  const f = {}; FORM.forEach(k => f[k] = $(k).value); CHECKS.forEach(k => f[k] = $(k).checked);
  store.set('ml-form', f);
}
[...FORM, ...CHECKS].forEach(k => $(k).addEventListener('input', () => { saveForm(); calc(); }));
$('jwt').addEventListener('change', () => { S.jwt = $('jwt').value.trim(); saveSettings(); });
$('logo').addEventListener('change', () => {
  logoFile = $('logo').files[0] || null;
  if (logoFile) { $('logoPrev').src = URL.createObjectURL(logoFile); $('logoTxt').hidden = true; draft.uri = null; saveDraft(); renderSteps(); }
});

function params() {
  const supply = Math.max(1, Math.floor(+$('supply').value || 1e9));
  const pct = Math.min(100, Math.max(1, +$('pct').value || 90));
  const mcapUsd = Math.max(1, +$('mcap').value || 6500);
  const solUsd = S.solUsd || 0;
  const startPriceSol = solUsd ? mcapUsd / solUsd / supply : 0;
  const poolTokens = Math.floor(supply * pct / 100);
  return { supply, pct, mcapUsd, solUsd, startPriceSol, poolTokens, mine: supply - poolTokens,
    feeBps: Math.round((+$('fee').value || 1) * 100), antiSniper: $('anti').checked, lock: $('lock').checked, mutable: $('mutable').checked };
}

const PRESETS = [
  { n: 'OMNI tipo', s: '90% · $6.5K', v: () => ({ pct: 90, mcap: 6500 }) },
  { n: 'pump.fun tipo', s: '80% · ~28 SOL', v: () => ({ pct: 80, mcap: Math.round(28 * (S.solUsd || 77)) }) },
  { n: 'Mažas startas', s: '95% · $2K', v: () => ({ pct: 95, mcap: 2000 }) },
  { n: 'Aukštesnis', s: '90% · $15K', v: () => ({ pct: 90, mcap: 15000 }) },
];
$('presets').innerHTML = PRESETS.map((p, i) => `<button class="chip" data-pr="${i}">${p.n}<small>${p.s}</small></button>`).join('');
$('presets').addEventListener('click', e => {
  const b = e.target.closest('[data-pr]'); if (!b) return;
  const v = PRESETS[+b.dataset.pr].v(); $('pct').value = v.pct; $('mcap').value = v.mcap; saveForm(); calc();
});

function calc() {
  const p = params();
  if (!p.solUsd) { $('calc').innerHTML = '<div class="note warn">Įvesk SOL kainą (skiltis „RPC ir SOL kaina“).</div>'; return; }
  const depth = p.poolTokens * p.startPriceSol;
  const need = r => depth * (Math.sqrt(r) - 1) / (1 - p.feeBps / 1e4);
  $('calc').innerHTML = kv([
    ['Startinis mcap', usd(p.mcapUsd) + ' · ' + sol(p.mcapUsd / p.solUsd)],
    ['Startinė kaina', tiny(p.startPriceSol) + ' SOL'],
    ['Į pool\'ą', tok(p.poolTokens) + ' (' + p.pct + '%)'],
    ['Lieka tau', tok(p.mine) + ' (' + (100 - p.pct).toFixed(1) + '%)'],
    ['Pool\'o gylis (virtualus)', sol(depth)],
    ['Iki ×2 mcap pirkėjams reikia', sol(need(2)) + ' · ' + usd(need(2) * p.solUsd)],
    ['Iki ×10 mcap', sol(need(10)) + ' · ' + usd(need(10) * p.solUsd)],
  ]);
}

// ---------- kaštai ----------
$('estimate').addEventListener('click', e => busy(e.target, async () => {
  if (!wallet) throw new Error('Pirma prisijunk su Phantom.');
  const p = params();
  const name = $('name').value.trim() || 'Test', symbol = $('symbol').value.trim() || 'TEST';
  const mintCost = draft.mint ? 0 : await C.estimateMintCost(conn, { payer: wallet, supply: p.supply, name, symbol, uri: draft.uri || $('uri').value.trim(), mutable: p.mutable });
  const poolCost = await C.estimatePoolCost(conn);
  const total = mintCost + poolCost;
  await refreshBal();
  const ok = wallet.bal >= total + 0.005;
  $('costOut').innerHTML = kv([
    ['Coino sukūrimas (mint + metadata)', draft.mint ? 'jau padaryta' : sol(mintCost) + ' · tiksliai pagal simuliaciją'],
    ['Pool\'o sukūrimas', '~' + sol(poolCost)],
    ['IPFS (Pinata)', 'nemokamai'],
    ['Iš viso', '<b>~' + sol(total) + (S.solUsd ? ' · ' + usd(total * S.solUsd) : '') + '</b>'],
    ['Tavo balansas', `<span class="${ok ? 'good' : 'warn'}">${sol(wallet.bal || 0)} ${ok ? '✓ užtenka' : '✗ trūksta'}</span>`],
  ]) + '<div class="hint">Didžioji dalis – „rent“ depozitai sąskaitoms. Į pool\'ą SOL dėti nereikia: pool\'as vienpusis, jame tik tavo tokenai.</div>';
}));

// ---------- paleidimas ----------
function renderSteps() {
  const ex = S.net === 'devnet' ? '?cluster=devnet' : '';
  const hasUri = !!(draft.uri || $('uri').value.trim());
  $('ipfsInfo').innerHTML = draft.uri ? `Įkelta ✓ <a href="${esc(draft.uri)}" target="_blank" rel="noopener">metadata</a>` : $('uri').value.trim() ? 'Naudojamas tavo URI ✓' : 'Reikia logotipo ir Pinata rakto';
  $('doIpfs').disabled = !!draft.mint;
  $('mintInfo').innerHTML = draft.mint ? `Sukurta ✓ <a href="https://solscan.io/token/${draft.mint}${ex}" target="_blank" rel="noopener">${short(draft.mint)}</a>` : 'Sukuria tokeną, metadata, atšaukia mint ir freeze authority';
  $('doMint').disabled = !!draft.mint || !hasUri;
  $('poolInfo').innerHTML = draft.pool ? `LIVE ✓ <a href="https://solscan.io/account/${draft.pool}${ex}" target="_blank" rel="noopener">${short(draft.pool)}</a>` : 'Vienpusis DAMM v2 pool\'as su tavo startiniu mcap';
  $('doPool').disabled = !draft.mint || !!draft.pool;
  ['st-ipfs', 'st-mint', 'st-pool'].forEach((id, i) => $(id).classList.toggle('done', [hasUri, !!draft.mint, !!draft.pool][i]));
}
$('uri').addEventListener('input', renderSteps);

$('doIpfs').addEventListener('click', e => busy(e.target, async () => {
  const meta = { name: $('name').value.trim(), symbol: $('symbol').value.trim().toUpperCase(), description: $('desc').value.trim(),
    website: $('website').value.trim(), twitter: $('twitter').value.trim(), telegram: $('telegram').value.trim() };
  if (!meta.name || !meta.symbol) throw new Error('Įrašyk pavadinimą ir tickerį.');
  if (!logoFile) throw new Error('Pasirink logotipą.');
  if (!S.jwt) throw new Error('Įvesk Pinata JWT (skiltis „Pinata raktas“).');
  const r = await C.uploadToPinata(S.jwt, { file: logoFile, meta });
  draft.uri = r.uri; draft.image = r.image; draft.meta = meta; saveDraft(); renderSteps();
  toast('Logotipas ir metadata įkelti į IPFS');
}));

$('doMint').addEventListener('click', e => busy(e.target, async () => {
  if (!wallet) throw new Error('Pirma prisijunk su Phantom.');
  const p = params();
  const name = $('name').value.trim(), symbol = $('symbol').value.trim().toUpperCase();
  if (!name || !symbol) throw new Error('Įrašyk pavadinimą ir tickerį.');
  const uri = draft.uri || $('uri').value.trim();
  if (!uri) throw new Error('Pirma įkelk metadata (a žingsnis) arba įrašyk URI.');
  if (S.net === 'mainnet' && !confirmBox(`Sukurti ${symbol} MAINNET'e? Supply ${tok(p.supply)}. Bus naudojami tikri SOL.`)) return;
  draft.balBefore = wallet.bal;
  const r = await C.mintToken(conn, { payer: wallet, supply: p.supply, name, symbol, uri, mutable: p.mutable });
  Object.assign(draft, { mint: r.mint, mintSig: r.sig, name, symbol, supply: p.supply, uri });
  saveDraft(); renderSteps(); refreshBal();
  toast('Coinas sukurtas: ' + short(r.mint));
}));

$('doPool').addEventListener('click', e => busy(e.target, async () => {
  if (!wallet) throw new Error('Pirma prisijunk su Phantom.');
  const p = params();
  if (!p.solUsd) throw new Error('Įvesk SOL kainą.');
  if (p.supply !== draft.supply) throw new Error('Supply skiriasi nuo sukurto coino (' + tok(draft.supply) + '). Grąžink tą patį skaičių.');
  if (S.net === 'mainnet' && !confirmBox(`Paleisti pool'ą MAINNET'e?\n${tok(p.poolTokens)} ${draft.symbol} į pool'ą, startinis mcap ${usd(p.mcapUsd)}.${p.lock ? '\nLiquidity bus užrakinta visam laikui.' : ''}`)) return;
  const r = await C.createPool(conn, { payer: wallet, mint: draft.mint, poolTokens: p.poolTokens, startPriceSol: p.startPriceSol, feeBps: p.feeBps, antiSniper: p.antiSniper, lock: p.lock });
  Object.assign(draft, { pool: r.pool, poolSig: r.sig, startPriceSol: p.startPriceSol, poolTokens: p.poolTokens, startMcapUsd: p.mcapUsd });
  saveDraft();
  await refreshBal();
  const spent = draft.balBefore ? draft.balBefore - (wallet.bal || 0) : null;
  const coin = { net: S.net, mint: draft.mint, pool: r.pool, name: draft.name, symbol: draft.symbol, supply: draft.supply,
    poolTokens: p.poolTokens, startPriceSol: p.startPriceSol, created: Date.now(), spent, image: draft.image };
  coins.unshift(coin); store.set('ml-coins', coins);
  renderSteps(); renderMine(); openLive(coin);
  toast('LIVE! ' + draft.symbol + ' pool\'as sukurtas');
}));

// Vietoj confirm() – Phantom naršyklėje jis veikia, bet laikom paprastą
function confirmBox(msg) { return window.confirm(msg); }

$('resetDraft').addEventListener('click', () => {
  if (draft.mint && !draft.pool && !confirmBox('Coinas sukurtas, bet pool\'as dar ne. Tikrai pradėti iš naujo? (Sukurtą coiną rasi Phantom\'e)')) return;
  draft = {}; saveDraft(); logoFile = null; $('logoPrev').removeAttribute('src'); $('logoTxt').hidden = false; renderSteps();
});

// ---------- live ----------
function links(c) {
  const dev = c.net === 'devnet', ex = dev ? '?cluster=devnet' : '';
  const L = [['Solscan', `https://solscan.io/token/${c.mint}${ex}`]];
  if (!dev) L.push(['DexScreener', `https://dexscreener.com/solana/${c.pool}`], ['Photon', `https://photon-sol.tinyastro.io/en/lp/${c.pool}`],
    ['GMGN', `https://gmgn.ai/sol/token/${c.mint}`], ['Meteora', `https://www.meteora.ag/dammv2/${c.pool}`]);
  return L.map(([n, u]) => `<a class="btn ghost" href="${u}" target="_blank" rel="noopener">${n}</a>`).join('') +
    `<button class="btn ghost" data-copy="${c.mint}">Kopijuoti CA</button>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-copy]'); if (!b) return;
  navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('CA nukopijuotas: ' + short(b.dataset.copy)), () => toast(b.dataset.copy));
});
function openLive(c) {
  liveCoin = c; $('s-live').hidden = false; $('links').innerHTML = links(c);
  if (c.net !== S.net) setNet(c.net);
  clearInterval(liveTimer); tick(); liveTimer = setInterval(tick, 10000);
  $('s-live').scrollIntoView({ behavior: 'smooth' });
}
async function tick() {
  const c = liveCoin; if (!c) return;
  try {
    const d = await C.fetchLive(conn, { mint: c.mint, pool: c.pool, owner: wallet?.toBase58(), supply: c.supply });
    const u = S.solUsd || 0, chg = (d.price / c.startPriceSol - 1) * 100;
    const sold = Math.max(0, c.poolTokens - d.poolTokens);
    $('lMcap').textContent = u ? usd(d.mcapSol * u) : sol(d.mcapSol);
    $('lMcapSol').textContent = sol(d.mcapSol);
    $('lChg').textContent = (chg >= 0 ? '+' : '') + chg.toFixed(1) + '%';
    $('lChg').className = 'big ' + (chg >= 0 ? 'good' : 'warn');
    $('liveKv').innerHTML = kv([
      ['Coinas', esc(c.name) + ' ($' + esc(c.symbol) + ')'],
      ['Kaina', tiny(d.price) + ' SOL' + (u ? ' · $' + tiny(d.price * u) : '')],
      ['SOL pool\'e (pirkėjų įnešta)', sol(d.poolSol) + (u ? ' · ' + usd(d.poolSol * u) : '')],
      ['Nupirkta iš pool\'o', tok(sold) + ' (' + (sold / c.supply * 100).toFixed(2) + '% supply)'],
      ['Tokenų pool\'e', tok(d.poolTokens) + ' (' + (d.poolTokens / c.supply * 100).toFixed(1) + '%)'],
      ['Tavo tokenai', wallet ? tok(d.mine) + ' (' + d.minePct.toFixed(2) + '%)' + (u ? ' · ' + usd(d.mine * d.price * u) + ' pagal kainą' : '') : 'prisijunk'],
      ['Paleidimas kainavo', c.spent ? sol(c.spent) : '–'],
      ['Atnaujinta', new Date().toLocaleTimeString('lt-LT')],
    ]);
  } catch (e) { console.error(e); $('lMcapSol').textContent = 'Nepavyko gauti duomenų (RPC?). Bandys vėl.'; }
}

function renderMine() {
  const list = coins.filter(c => c.net === S.net);
  $('mine').innerHTML = list.length ? list.map((c, i) => `<button class="coin" data-coin="${coins.indexOf(c)}">
    ${c.image ? `<img src="${esc(c.image)}" alt="">` : '<span class="ph"></span>'}
    <span><b>${esc(c.symbol)}</b> ${esc(c.name)}<small>${new Date(c.created).toLocaleString('lt-LT')} · ${short(c.mint)}</small></span></button>`).join('')
    : `<div class="hint">Dar nieko nepaleidai ${S.net === 'devnet' ? 'devnet\'e' : 'mainnet\'e'}.</div>`;
}
$('mine').addEventListener('click', e => { const b = e.target.closest('[data-coin]'); if (b) openLive(coins[+b.dataset.coin]); });

// ---------- start ----------
(async () => {
  loadForm();
  if (!C.getProvider()) { $('noPhantom').hidden = false; $('connect').hidden = true; }
  setNet(S.net || 'devnet');
  if (!S.solUsd) { const p = await C.fetchSolUsd(); if (p) { S.solUsd = p; saveSettings(); } }
  else C.fetchSolUsd().then(p => { if (p) { S.solUsd = p; saveSettings(); $('solUsd').value = p; calc(); } });
  $('solUsd').value = S.solUsd || '';
  calc(); renderSteps();
  const prov = C.getProvider();
  if (prov) { try { const r = await prov.connect({ onlyIfTrusted: true }); wallet = new PublicKey(r.publicKey.toString()); showWallet(); } catch {} }
})();
