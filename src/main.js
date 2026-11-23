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
const FORM = ['name', 'symbol', 'desc', 'website', 'twitter', 'telegram', 'uri', 'supply', 'pct', 'mcap', 'fee', 'devbuy'];
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
let autoRpc = {};
function rpcUrl() { return (S.rpc[S.net] || '').trim() || autoRpc[S.net] || C.DEFAULT_RPC[S.net][0]; }
async function ensureRpc() {
  if ((S.rpc[S.net] || '').trim() || autoRpc[S.net]) return;
  $('rpcInfo').textContent = 'Ieškau veikiančio RPC…';
  const url = await C.pickRpc(C.DEFAULT_RPC[S.net]);
  if (url) { autoRpc[S.net] = url; conn = C.makeConnection(url); }
  showRpc(url ? '' : 'Nė vienas nemokamas RPC neatsako. Įvesk savo (pvz. Helius) žemiau.');
}
function showRpc(err) {
  $('rpcInfo').textContent = err || ('RPC: ' + new URL(rpcUrl()).host);
  $('rpcInfo').className = 'hint' + (err ? ' warn' : '');
}
async function setNet(n) {
  S.net = n; saveSettings();
  conn = C.makeConnection(rpcUrl());
  draft = store.get(draftKey(), {});
  document.querySelectorAll('[data-net]').forEach(b => b.classList.toggle('on', b.dataset.net === n));
  $('rpc').value = S.rpc[n] || '';
  $('netWarn').textContent = n === 'mainnet' ? 'MAINNET – tikri pinigai' : 'DEVNET – testinis tinklas, pinigai netikri';
  $('netWarn').className = 'banner ' + n;
  $('airdrop').hidden = n !== 'devnet';
  renderSteps(); renderMine();
  await ensureRpc();
  refreshBal(); checkPending(); loadWalletTokens();
}
document.querySelectorAll('[data-net]').forEach(b => b.addEventListener('click', () => {
  if (b.dataset.net === 'mainnet' && S.net !== 'mainnet') toast('Perjungta į MAINNET – čia naudojami tikri SOL.');
  setNet(b.dataset.net);
}));
$('rpc').addEventListener('change', () => { S.rpc[S.net] = $('rpc').value.trim(); saveSettings(); conn = C.makeConnection(rpcUrl()); showRpc(); refreshBal(); });
$('solUsd').addEventListener('input', () => { S.solUsd = +$('solUsd').value || 0; saveSettings(); calc(); });

// ---------- wallet ----------
async function refreshBal() {
  if (!wallet || !conn) return;
  try { const b = await C.getSolBalance(conn, wallet); $('bal').textContent = sol(b) + (S.solUsd ? ' (' + usd(b * S.solUsd) + ')' : ''); wallet.bal = b; }
  catch (e) {
    console.warn(e);
    // bandome kitą RPC, jei vartotojas nenustatė savo
    if (!(S.rpc[S.net] || '').trim() && !refreshBal.retry) {
      refreshBal.retry = true; autoRpc[S.net] = null;
      const list = C.DEFAULT_RPC[S.net].filter(u => u !== conn.rpcEndpoint);
      const url = await C.pickRpc(list);
      if (url) { autoRpc[S.net] = url; conn = C.makeConnection(url); showRpc(); refreshBal.retry = false; return refreshBal(); }
      refreshBal.retry = false;
    }
    $('bal').textContent = 'nepavyko – žr. „RPC ir SOL kaina“';
    showRpc('RPC neatsako. Įvesk savo RPC (pvz. nemokamą Helius) žemiau.');
  }
}
function showWallet() {
  $('connect').hidden = true; $('walletInfo').hidden = false;
  $('addr').textContent = short(wallet.toBase58()); refreshBal(); loadWalletTokens();
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
  jwtBadge();
}
function saveForm() {
  const f = {}; FORM.forEach(k => f[k] = $(k).value); CHECKS.forEach(k => f[k] = $(k).checked);
  store.set('ml-form', f);
}
[...FORM, ...CHECKS].forEach(k => $(k).addEventListener('input', () => { saveForm(); calc(); }));
function jwtBadge() {
  $('jwtBadge').textContent = S.jwt ? '· išsaugotas ✓' : '· neįvestas';
  $('jwtBadge').className = S.jwt ? 'good' : 'warn';
}
$('jwt').addEventListener('input', () => { S.jwt = $('jwt').value.trim(); saveSettings(); jwtBadge(); $('jwtStatus').textContent = S.jwt ? 'Išsaugota šiame telefone.' : ''; });
$('jwtTest').addEventListener('click', e => busy(e.target, async () => {
  S.jwt = $('jwt').value.trim(); saveSettings(); jwtBadge();
  if (!S.jwt) throw new Error('Pirma įklijuok JWT.');
  const ok = await C.testPinata(S.jwt);
  $('jwtStatus').textContent = ok ? '✓ Raktas veikia – Pinata jį priėmė.' : '✗ Pinata rakto nepriima. Patikrink, ar nukopijavai visą JWT (prasideda eyJ...).';
  $('jwtStatus').className = 'hint ' + (ok ? 'good' : 'warn');
}));
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
    devBuy: Math.max(0, +$('devbuy').value || 0),
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
    ...(p.devBuy > 0 ? (() => {
      const f = (p.antiSniper ? 0.5 : p.feeBps / 1e4), x = depth + p.devBuy * (1 - f), r = (x / depth) ** 2;
      return [['Po dev buy mcap', usd(p.mcapUsd * r) + ' · gausi ~' + tok(p.poolTokens * (1 - depth / x))]];
    })() : []),
  ]) + (p.devBuy > 0 && p.antiSniper ? '<div class="note warn" style="margin-top:10px">Įjungtas anti-sniper: pirmas 10 min pirkimų fee iki 50%, tai liečia ir tavo dev buy. Dev buy metu jį geriau išjungti.</div>' : '');
}

// ---------- kaštai ----------
$('estimate').addEventListener('click', e => busy(e.target, async () => {
  if (!wallet) throw new Error('Pirma prisijunk su Phantom.');
  const p = params();
  const name = $('name').value.trim() || 'Test', symbol = $('symbol').value.trim() || 'TEST';
  const mintCost = draft.mint ? 0 : await C.estimateMintCost(conn, { payer: wallet, supply: p.supply, name, symbol, uri: draft.uri || $('uri').value.trim(), mutable: p.mutable });
  const poolCost = await C.estimatePoolCost(conn);
  const total = mintCost + poolCost + p.devBuy;
  await refreshBal();
  const ok = wallet.bal >= total + 0.005;
  $('costOut').innerHTML = kv([
    ['Coino sukūrimas (mint + metadata)', draft.mint ? 'jau padaryta' : sol(mintCost) + ' · tiksliai pagal simuliaciją'],
    ['Pool\'o sukūrimas', '~' + sol(poolCost)],
    ['IPFS (Pinata)', 'nemokamai'],
    ...(p.devBuy > 0 ? [['Dev buy', sol(p.devBuy)]] : []),
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
  $('recover').hidden = !!draft.mint;
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
  Object.assign(draft, { name, symbol, supply: p.supply, uri });
  let r;
  try {
    r = await C.mintToken(conn, { payer: wallet, supply: p.supply, name, symbol, uri, mutable: p.mutable }, m => { draft.pendingMint = m; saveDraft(); });
  } catch (err) {
    // gal transakcija vis tiek praėjo?
    if (draft.pendingMint && await C.accountExists(conn, draft.pendingMint)) r = { mint: draft.pendingMint, sig: null };
    else throw err;
  }
  Object.assign(draft, { mint: r.mint, mintSig: r.sig, pendingMint: null });
  saveDraft(); renderSteps(); refreshBal();
  toast('Coinas sukurtas: ' + short(r.mint));
}));

$('doPool').addEventListener('click', e => busy(e.target, async () => {
  if (!wallet) throw new Error('Pirma prisijunk su Phantom.');
  const p = params();
  if (!p.solUsd) throw new Error('Įvesk SOL kainą.');
  if (p.supply !== draft.supply) throw new Error('Supply skiriasi nuo sukurto coino (' + tok(draft.supply) + '). Grąžink tą patį skaičių.');
  if (S.net === 'mainnet' && !confirmBox(`Paleisti pool'ą MAINNET'e?\n${tok(p.poolTokens)} ${draft.symbol} į pool'ą, startinis mcap ${usd(p.mcapUsd)}.${p.lock ? '\nLiquidity bus užrakinta visam laikui.' : ''}`)) return;
  let r;
  try {
    r = await C.createPool(conn, { payer: wallet, mint: draft.mint, poolTokens: p.poolTokens, startPriceSol: p.startPriceSol, feeBps: p.feeBps, antiSniper: p.antiSniper, lock: p.lock }, pl => { draft.pendingPool = pl; saveDraft(); });
  } catch (err) {
    const found = (draft.pendingPool && await C.accountExists(conn, draft.pendingPool)) ? draft.pendingPool : await C.findPool(conn, draft.mint);
    if (found) r = { pool: found, sig: null };
    else throw err;
  }
  draft.pendingPool = null;
  Object.assign(draft, { pool: r.pool, poolSig: r.sig, startPriceSol: p.startPriceSol, poolTokens: p.poolTokens, startMcapUsd: p.mcapUsd });
  saveDraft();
  await refreshBal();
  const spent = draft.balBefore ? draft.balBefore - (wallet.bal || 0) : null;
  const coin = { net: S.net, mint: draft.mint, pool: r.pool, name: draft.name, symbol: draft.symbol, supply: draft.supply,
    poolTokens: p.poolTokens, startPriceSol: p.startPriceSol, created: Date.now(), spent, image: draft.image };
  coins.unshift(coin); store.set('ml-coins', coins);
  renderSteps(); renderMine(); openLive(coin);
  toast('LIVE! ' + draft.symbol + ' pool\'as sukurtas' + (p.devBuy > 0 ? '. Dabar patvirtink dev buy Phantom\'e.' : ''));
  if (p.devBuy > 0) {
    try {
      const b = await C.devBuy(conn, { payer: wallet, pool: r.pool, solAmount: p.devBuy });
      toast('Dev buy atliktas: ~' + tok(b.expectedOut) + ' ' + draft.symbol);
      refreshBal(); tick();
    } catch (err) { toast('Pool\'as LIVE, bet dev buy nepavyko: ' + (err.message || err) + '. Gali pirkti apačioje „Pirkti už SOL“.', true); }
  }
}));

// Vietoj confirm() – Phantom naršyklėje jis veikia, bet laikom paprastą
function confirmBox(msg) { return window.confirm(msg); }

async function useMint(mint, meta = {}) {
  if (!wallet) throw new Error('Pirma prisijunk su Phantom.');
  const m = await C.readMint(conn, mint, wallet);
  if (m.decimals !== C.DECIMALS) throw new Error('Šis coinas turi ' + m.decimals + ' decimals, programa palaiko tik ' + C.DECIMALS + '.');
  if (m.mine === 0) throw new Error('Tavo pagrindinėje šio coino sąskaitoje tokenų nerasta. Patikrink, ar įklijavai teisingą CA (Phantom → coinas → Token address).');
  draft.mint = mint; draft.supply = m.supply; draft.pendingMint = null;
  draft.name = meta.name || draft.name || $('name').value.trim();
  draft.symbol = meta.symbol || draft.symbol || $('symbol').value.trim().toUpperCase();
  if (meta.uri) draft.uri = meta.uri;
  $('supply').value = m.supply; saveForm(); calc();
  saveDraft(); renderSteps();
  toast((draft.symbol || 'Coinas') + ' pasirinktas' + (m.mine ? ': ' + tok(m.mine) + ' tavo wallet\'e' : '') + '. Gali kurti pool\'ą.');
}
$('recBtn').addEventListener('click', e => busy(e.target, async () => {
  const mint = $('recMint').value.trim();
  if (!mint) throw new Error('Įklijuok coino CA.');
  await useMint(mint);
}));
let walletTokens = [];
async function loadWalletTokens() {
  if (!wallet || draft.mint) return;
  $('walletTokens').innerHTML = '<div class="hint">Kraunu…</div>';
  try {
    walletTokens = await C.listWalletTokens(conn, wallet, C.DEFAULT_RPC[S.net]);
    const pooled = new Set(coins.filter(c => c.net === S.net).map(c => c.mint));
    const list = walletTokens.filter(t => t.decimals === C.DECIMALS);
    $('walletTokens').innerHTML = list.length ? list.map((t, i) => `<button class="coin" data-wt="${walletTokens.indexOf(t)}">
      <span class="ph"></span><span><b>${esc(t.symbol || '?')}</b>${esc(t.name || short(t.mint))}<small>${tok(t.amount)} · ${short(t.mint)}${pooled.has(t.mint) ? ' · jau turi pool\'ą' : ''}</small></span></button>`).join('')
      : '<div class="hint">Tinkamų coinų wallet\'e nerasta.</div>';
  } catch (e) {
    console.warn(e);
    const msg = String(e?.message || e).slice(0, 140);
    $('walletTokens').innerHTML = '<div class="hint warn">Nepavyko nuskaityti wallet\'o: ' + esc(msg) + '<br>Įdėk nemokamą Helius RPC (skiltis „RPC ir SOL kaina“) arba įvesk CA ranka žemiau.</div>';
  }
}
$('walletTokens').addEventListener('click', e => {
  const b = e.target.closest('[data-wt]'); if (!b) return;
  const t = walletTokens[+b.dataset.wt];
  b.disabled = true; b.style.opacity = .5;
  useMint(t.mint, t).catch(err => toast(err.message || String(err), true)).finally(() => { b.disabled = false; b.style.opacity = ''; });
});
$('recRefresh').addEventListener('click', loadWalletTokens);

// Pridėti rastą paleistą coiną į sąrašą ir atidaryti live
async function adoptLaunched(mint, pool, extra = {}) {
  let c = coins.find(x => x.mint === mint && x.net === S.net);
  if (!c) {
    let supply = extra.supply || draft.supply || 1e9;
    try { supply = (await C.readMint(conn, mint, wallet || mint)).supply; } catch {}
    c = { net: S.net, mint, pool, name: extra.name || draft.name || '', symbol: extra.symbol || draft.symbol || '?', supply,
      poolTokens: extra.poolTokens || Math.floor(supply * 0.9), startPriceSol: extra.startPriceSol || draft.startPriceSol || params().startPriceSol || 1e-9,
      created: Date.now(), image: draft.image };
    coins.unshift(c); store.set('ml-coins', coins);
  }
  if (draft.mint === mint) { draft.pool = pool; saveDraft(); }
  renderSteps(); renderMine(); openLive(c);
  return c;
}
$('findBtn').addEventListener('click', e => busy(e.target, async () => {
  const mint = $('findMint').value.trim();
  if (!mint) throw new Error('Įklijuok coino CA.');
  const pool = await C.findPool(conn, mint);
  if (!pool) throw new Error('Šiam coinui Meteora pool\'as nerastas (' + (S.net) + ').');
  await adoptLaunched(mint, pool);
  $('findBox').open = false; toast('Rasta! Rodau live informaciją.');
}));

// Jei mint'as liko „pakibęs“ – patikrinam tinkle
async function checkPending() {
  if (draft.mint && !draft.pool) {
    const pool = await C.findPool(conn, draft.mint);
    if (pool) { await adoptLaunched(draft.mint, pool); toast('Tavo pool\'as rastas – coinas LIVE ✓'); return; }
  }
  if (draft.pendingMint && !draft.mint && await C.accountExists(conn, draft.pendingMint)) {
    draft.mint = draft.pendingMint; draft.pendingMint = null; saveDraft(); renderSteps(); toast('Coinas rastas tinkle ✓');
  }
}

$('resetDraft').addEventListener('click', () => {
  if (draft.mint && !draft.pool && !confirmBox('Coinas sukurtas, bet pool\'as dar ne. Tikrai pradėti iš naujo? (Sukurtą coiną rasi Phantom\'e)')) return;
  draft = {}; saveDraft(); logoFile = null; setTimeout(loadWalletTokens); $('logoPrev').removeAttribute('src'); $('logoTxt').hidden = false; renderSteps();
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
$('buyMore').addEventListener('click', e => busy(e.target, async () => {
  if (!wallet) throw new Error('Pirma prisijunk su Phantom.');
  if (!liveCoin) throw new Error('Pasirink coiną.');
  const amt = +$('buyAmt').value || 0;
  if (amt <= 0) throw new Error('Įvesk SOL kiekį.');
  if (liveCoin.net === 'mainnet' && !confirmBox('Pirkti ' + liveCoin.symbol + ' už ' + amt + ' SOL?')) return;
  const b = await C.devBuy(conn, { payer: wallet, pool: liveCoin.pool, solAmount: amt });
  toast('Nupirkta ~' + tok(b.expectedOut) + ' ' + liveCoin.symbol);
  refreshBal(); tick();
}));

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
