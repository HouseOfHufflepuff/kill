# KILL Token — Registry Submissions

After deploying KillToken.sol to Base mainnet, replace every instance of
`KILL_CONTRACT_ADDRESS` below with the actual checksummed contract address
(e.g. `0xABCd...`). All logo submissions require a **square PNG, 256×256px,
< 100 KB**.

---

## 1. Prepare the logo

The source image is `viewer/images/Kill_79.png` (1456×816, landscape).
You must crop and export a square version before submitting anywhere.

```shell
# macOS — crop to 816×816 centered, then scale to 256×256
sips --cropToHeightWidth 816 816 viewer/images/Kill_79.png \
     --out /tmp/kill_square.png
sips --resampleHeightWidth 256 256 /tmp/kill_square.png \
     --out token-registry/logo.png
```

Verify it meets requirements:
```shell
sips -g pixelWidth -g pixelHeight -g fileSize token-registry/logo.png
```

Target: 256×256, < 100 000 bytes.

---

## 2. Trust Wallet Assets (MetaMask, Trust Wallet, most DEX UIs)

**Repo:** https://github.com/trustwallet/assets

Steps:
1. Fork `trustwallet/assets`
2. Copy prepared logo to:
   `blockchains/base/assets/KILL_CONTRACT_ADDRESS/logo.png`
   (address must be checksummed — use `cast to-checksum-address KILL_CONTRACT_ADDRESS`)
3. Copy `token-registry/trust-wallet/blockchains/base/assets/KILL_CONTRACT_ADDRESS/info.json`
   to the same folder, replacing `KILL_CONTRACT_ADDRESS` in the file contents
4. Open a PR — title: `Add KILL token on Base`
5. The address folder name must exactly match the EIP-55 checksum address

The files expected per asset:
```
blockchains/base/assets/
  0xYourChecksumAddress/
    logo.png    ← 256×256, < 100 KB
    info.json   ← see token-registry/trust-wallet/.../info.json
```

---

## 3. Base Official Token List

**Repo:** https://github.com/base-org/tokenlists

Steps:
1. Fork `base-org/tokenlists`
2. Add the KILL entry from `token-registry/base-tokenlist/kill-tokenlist.json`
   into the appropriate list JSON in that repo
3. Host `logo.png` at a stable public URL (e.g. `https://killgame.ai/logo.png`)
   and set that as `logoURI` in the token entry
4. Open a PR

---

## 4. Basescan — Token Info Update

1. Deploy and verify the contract on basescan.org
2. Go to: `https://basescan.org/token/KILL_CONTRACT_ADDRESS`
3. Click **"Update Token Info"** (requires signing with contract owner wallet)
4. Fill in: name, symbol, decimals, website, logo URL, description, socials

---

## 5. CoinGecko

Submit after the token has on-chain liquidity:
https://www.coingecko.com/en/coins/add-token-v2

Required: contract address, logo (500×500 recommended for CG), website,
description, social links, proof of liquidity.

---

## 6. DexScreener / DexTools (auto + manual)

Both auto-detect tokens once they appear in a liquidity pool. To update the
logo and info manually:

- DexScreener: https://dexscreener.com/base/KILL_CONTRACT_ADDRESS → "Update Token Info"
- DexTools: https://www.dextools.io → search address → "Update Info"

Both require connecting the contract owner wallet to verify ownership.
