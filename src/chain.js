// Visa Solana / Meteora / Metaplex logika
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage,
  VersionedTransaction, ComputeBudgetProgram, LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID, NATIVE_MINT, MINT_SIZE, AuthorityType,
  createInitializeMint2Instruction, getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction,
  createSetAuthorityInstruction,
} from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createNoopSigner, publicKey as umiPk, none } from '@metaplex-foundation/umi';
import { mplTokenMetadata, createMetadataAccountV3 } from '@metaplex-foundation/mpl-token-metadata';
import { toWeb3JsInstruction } from '@metaplex-foundation/umi-web3js-adapters';
import {
  CpAmm, getSqrtPriceFromPrice, getPriceFromSqrtPrice, MAX_SQRT_PRICE,
  getBaseFeeParams, getDynamicFeeParams, BaseFeeMode, CollectFeeMode, ActivationType,
} from '@meteora-ag/cp-amm-sdk';
import BN from 'bn.js';

export const DECIMALS = 6;
export const SOL_DECIMALS = 9;
// Keli nemokami RPC – naršyklėje naudojamas pirmas veikiantis
export const DEFAULT_RPC = {
  mainnet: ['https://solana-rpc.publicnode.com', 'https://solana.drpc.org', 'https://api.mainnet-beta.solana.com'],
  devnet: ['https://api.devnet.solana.com', 'https://solana-devnet-rpc.publicnode.com'],
};

export async function pickRpc(list) {
  for (const url of list) {
    try {
      const c = new Connection(url, 'confirmed');
      await Promise.race([c.getLatestBlockhash(), new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 6000))]);
      return url;
    } catch (e) { console.warn('RPC neveikia:', url, e.message); }
  }
  return null;
}
const PRIORITY_MICROLAMPORTS = 200_000; // ~0.00008 SOL už 400k CU

export function makeConnection(rpc) {
  return new Connection(rpc, 'confirmed');
}

// ---------- Phantom ----------
export function getProvider() {
  const p = window.phantom?.solana || window.solana;
  return p && p.isPhantom ? p : null;
}
export async function connectWallet() {
  const p = getProvider();
  if (!p) throw new Error('Phantom nerastas. Atidaryk šį puslapį Phantom programėlės naršyklėje.');
  const r = await p.connect();
  return new PublicKey(r.publicKey.toString());
}

async function signAndSend(conn, tx, extraSigners = []) {
  const p = getProvider();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  // Phantom pasirašo pirmas, tada papildomi raktai (Phantom rekomendacija)
  const signed = await p.signTransaction(tx);
  for (const kp of extraSigners) signed.partialSign(kp);
  const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 5 });
  const res = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  if (res.value.err) throw new Error('Transakcija nepavyko: ' + JSON.stringify(res.value.err));
  return sig;
}

function budget(units = 400_000) {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
  ];
}

export const toRaw = (n, dec = DECIMALS) => new BN(Math.round(n)).mul(new BN(10).pow(new BN(dec)));

// ---------- Mint ----------
async function buildMintTx(conn, { payer, mint, supply, name, symbol, uri, mutable }) {
  const rent = await conn.getMinimumBalanceForRentExemption(MINT_SIZE);
  const ata = getAssociatedTokenAddressSync(mint, payer);

  const umi = createUmi(conn.rpcEndpoint).use(mplTokenMetadata());
  const signer = createNoopSigner(umiPk(payer.toBase58()));
  const metaIx = createMetadataAccountV3(umi, {
    mint: umiPk(mint.toBase58()),
    mintAuthority: signer,
    payer: signer,
    updateAuthority: signer,
    data: { name, symbol, uri, sellerFeeBasisPoints: 0, creators: none(), collection: none(), uses: none() },
    isMutable: mutable,
    collectionDetails: none(),
  }).getInstructions()[0];

  const tx = new Transaction();
  tx.add(
    ...budget(200_000),
    SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: mint, lamports: rent, space: MINT_SIZE, programId: TOKEN_PROGRAM_ID }),
    createInitializeMint2Instruction(mint, DECIMALS, payer, null), // freeze authority = nėra
    createAssociatedTokenAccountIdempotentInstruction(payer, ata, payer, mint),
    createMintToInstruction(mint, ata, payer, BigInt(toRaw(supply).toString())),
    toWeb3JsInstruction(metaIx),
    createSetAuthorityInstruction(mint, payer, AuthorityType.MintTokens, null), // mint authority atšaukta
  );
  tx.feePayer = payer;
  return tx;
}

export async function mintToken(conn, opts) {
  const mintKp = Keypair.generate();
  const tx = await buildMintTx(conn, { ...opts, mint: mintKp.publicKey });
  const sig = await signAndSend(conn, tx, [mintKp]);
  return { mint: mintKp.publicKey.toBase58(), sig };
}

// Tikslus mint kaštas – simuliacija be parašų
export async function estimateMintCost(conn, opts) {
  const mint = Keypair.generate().publicKey;
  const tx = await buildMintTx(conn, { ...opts, mint, uri: opts.uri || 'https://ipfs.io/ipfs/' + 'x'.repeat(59) });
  const { blockhash } = await conn.getLatestBlockhash();
  const msg = new TransactionMessage({ payerKey: opts.payer, recentBlockhash: blockhash, instructions: tx.instructions }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);
  const pre = await conn.getBalance(opts.payer);
  const sim = await conn.simulateTransaction(vtx, {
    sigVerify: false, replaceRecentBlockhash: true,
    accounts: { encoding: 'base64', addresses: [opts.payer.toBase58()] },
  });
  if (sim.value.err) {
    const logs = (sim.value.logs || []).slice(-6).join('\n');
    throw new Error('Simuliacija nepavyko (ar wallet\'e užtenka SOL?): ' + JSON.stringify(sim.value.err) + '\n' + logs);
  }
  const post = sim.value.accounts?.[0]?.lamports ?? pre;
  const feeRes = await conn.getFeeForMessage(msg);
  const fee = (feeRes.value || 5000) + Math.ceil(200_000 * PRIORITY_MICROLAMPORTS / 1e6);
  const spent = Math.max(pre - post, 0);
  return (spent > fee ? spent : spent + fee) / LAMPORTS_PER_SOL;
}

// Pool'o kaštas – iš sąskaitų dydžių (apytikriai)
export async function estimatePoolCost(conn) {
  const sizes = [1112, 408, 400, 170, 165, 165, 165]; // pool, position, position NFT mint, NFT ATA, 2 vaultai, WSOL ATA
  const rents = await Promise.all(sizes.map(s => conn.getMinimumBalanceForRentExemption(s)));
  const fees = 10_000 + Math.ceil(400_000 * PRIORITY_MICROLAMPORTS / 1e6);
  return (rents.reduce((a, b) => a + b, 0) + fees) / LAMPORTS_PER_SOL;
}

// ---------- Pool ----------
// startPriceSol = SOL už 1 tokeną
export async function createPool(conn, { payer, mint, poolTokens, startPriceSol, feeBps, antiSniper, lock }) {
  const cpAmm = new CpAmm(conn);
  const tokenAMint = new PublicKey(mint);
  const initSqrtPrice = getSqrtPriceFromPrice(String(startPriceSol), DECIMALS, SOL_DECIMALS);
  const tokenAAmount = toRaw(poolTokens);
  const liquidityDelta = cpAmm.preparePoolCreationSingleSide({
    tokenAAmount, minSqrtPrice: initSqrtPrice, maxSqrtPrice: MAX_SQRT_PRICE, initSqrtPrice,
    collectFeeMode: CollectFeeMode.OnlyB,
  });
  const baseFee = antiSniper
    ? getBaseFeeParams({ baseFeeMode: BaseFeeMode.FeeTimeSchedulerExponential,
        feeTimeSchedulerParam: { startingFeeBps: 5000, endingFeeBps: feeBps, numberOfPeriod: 60, totalDuration: 600 } })
    : getBaseFeeParams({ baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear,
        feeTimeSchedulerParam: { startingFeeBps: feeBps, endingFeeBps: feeBps, numberOfPeriod: 0, totalDuration: 0 } });
  const poolFees = { baseFee, compoundingFeeBps: 0, padding: 0, dynamicFee: getDynamicFeeParams(feeBps) };
  const positionNft = Keypair.generate();

  const { tx, pool, position } = await cpAmm.createCustomPool({
    payer, creator: payer, positionNft: positionNft.publicKey,
    tokenAMint, tokenBMint: NATIVE_MINT,
    tokenAAmount, tokenBAmount: new BN(0),
    sqrtMinPrice: initSqrtPrice, sqrtMaxPrice: MAX_SQRT_PRICE,
    liquidityDelta, initSqrtPrice, poolFees,
    hasAlphaVault: false, activationType: ActivationType.Timestamp,
    collectFeeMode: CollectFeeMode.OnlyB, activationPoint: null,
    tokenAProgram: TOKEN_PROGRAM_ID, tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: lock,
  });
  const full = new Transaction().add(...budget(400_000), ...tx.instructions);
  full.feePayer = payer;
  const sig = await signAndSend(conn, full, [positionNft]);
  return { pool: pool.toBase58(), position: position.toBase58(), sig };
}

// ---------- Live ----------
export async function fetchLive(conn, { mint, pool, owner, supply }) {
  const cpAmm = new CpAmm(conn);
  const st = await cpAmm.fetchPoolState(new PublicKey(pool));
  const price = Number(getPriceFromSqrtPrice(st.sqrtPrice, DECIMALS, SOL_DECIMALS).toString());
  const [aBal, bBal] = await Promise.all([
    conn.getTokenAccountBalance(st.tokenAVault),
    conn.getTokenAccountBalance(st.tokenBVault),
  ]);
  let mine = 0;
  if (owner) {
    try {
      const ata = getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner));
      mine = Number((await conn.getTokenAccountBalance(ata)).value.uiAmount || 0);
    } catch { mine = 0; }
  }
  return {
    price, mcapSol: price * supply,
    poolTokens: Number(aBal.value.uiAmount || 0),
    poolSol: Number(bBal.value.uiAmount || 0),
    mine, minePct: mine / supply * 100,
  };
}

export async function getSolBalance(conn, pk) {
  return (await conn.getBalance(pk)) / LAMPORTS_PER_SOL;
}

export async function airdrop(conn, pk) {
  const sig = await conn.requestAirdrop(pk, LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');
}

// ---------- Pinata (IPFS) ----------
const GATEWAY = 'https://ipfs.io/ipfs/';
export async function uploadToPinata(jwt, { file, meta }) {
  const fd = new FormData();
  fd.append('file', file, file.name || 'logo.png');
  fd.append('pinataMetadata', JSON.stringify({ name: (meta.symbol || 'token') + '-logo' }));
  const r1 = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt }, body: fd });
  if (!r1.ok) throw new Error('Pinata logotipo įkėlimas nepavyko (' + r1.status + '). Patikrink JWT raktą.');
  const image = GATEWAY + (await r1.json()).IpfsHash;
  const json = {
    name: meta.name, symbol: meta.symbol, description: meta.description, image,
    showName: true, createdOn: 'meteora-launcher',
    ...(meta.website && { website: meta.website }), ...(meta.twitter && { twitter: meta.twitter }), ...(meta.telegram && { telegram: meta.telegram }),
    extensions: { website: meta.website || undefined, twitter: meta.twitter || undefined, telegram: meta.telegram || undefined },
  };
  const r2 = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST', headers: { Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pinataContent: json, pinataMetadata: { name: (meta.symbol || 'token') + '-metadata' } }),
  });
  if (!r2.ok) throw new Error('Pinata metadata įkėlimas nepavyko (' + r2.status + ').');
  return { uri: GATEWAY + (await r2.json()).IpfsHash, image };
}

export async function fetchSolUsd() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const j = await r.json();
    return j?.solana?.usd || null;
  } catch { return null; }
}
