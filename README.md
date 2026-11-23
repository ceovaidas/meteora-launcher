# Meteora Launcher

Web programa Solana tokeno paleidimui per Meteora DAMM v2, pritaikyta telefonui (Phantom naršyklei).

## Ką daro

1. **Wallet** – prisijungi su Phantom (private key niekur neįvedamas, kiekvieną transakciją patvirtini Phantom'e), matai SOL balansą.
2. **Coino informacija** – logotipas, pavadinimas, tickeris, aprašymas, nuorodos. Logotipas ir metadata keliami į IPFS per Pinata.
3. **Nustatymai** – supply, kiek % į pool'ą, startinis mcap, swap fee, anti-sniper fee, liquidity užrakinimas.
4. **Kaštai** – mint kaštas skaičiuojamas tiksliai (simuliacija), pool'o – apytikriai pagal sąskaitų dydžius.
5. **Paleidimas** – a) IPFS, b) mint (viena transakcija: tokenas + metadata, mint ir freeze authority atšaukiamos), c) vienpusis DAMM v2 pool'as.
6. **Live** – mcap, pokytis nuo starto, SOL pool'e, kiek nupirkta, tavo dalis, nuorodos (Solscan, DexScreener, Photon, GMGN, Meteora).

## Kaip naudoti

- Atsidaryk programos nuorodą **Phantom programėlės naršyklėje**.
- Pirmiausia viską išbandyk **Devnet** režimu (testiniai SOL iš faucet.solana.com).
- Mainnet'ui rekomenduojamas nemokamas Helius RPC (helius.dev) – įvedamas skiltyje „RPC ir SOL kaina“.
- Naudok atskirą wallet'ą, ne pagrindinį.

## Techniškai

Vite + `@solana/web3.js`, `@solana/spl-token`, Metaplex Token Metadata, `@meteora-ag/cp-amm-sdk`.
Pool'as: `createCustomPool`, vienpusis (tik tokenai), kainos intervalas nuo startinės kainos iki maksimalios, fee renkami SOL.
Deploy: GitHub Actions → GitHub Pages (`.github/workflows/pages.yml`).

```
npm install
npm run dev
```
