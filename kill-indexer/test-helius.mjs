import { createHelius } from "helius-sdk";

const helius = createHelius({
  apiKey: "fbda4008-03a0-4aad-8f64-c54e7fd9147e",
  cluster: "devnet",
});

// Connectivity test — DAS API call
const result = await helius.getAssetsByOwner({
  ownerAddress: "So11111111111111111111111111111111111111112",
  page: 1,
  limit: 1,
});

console.log("Helius devnet connected. DAS response:", result?.total, "assets");
