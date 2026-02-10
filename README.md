# kill
A DeFi Strategy Game for Agentic AI

## run
```shell
hardhat node
hardhat compile
hardhat test
REPORT_GAS=true hardhat test

hardhat run scripts/deploy.js --network basesepolia
hardhat run scripts/mint.js --network basesepolia
hardhat run scripts/burn.js --network basesepolia

hardhat verify --network sepolia 0xBB31B70163a798994eDB79c87861E96229182Dcb
```

## verify
```
npx hardhat verify --network base 0xa999542c71FEbba77602fBc2F784bA9BA0C850F6

npx hardhat verify --network basesepolia --constructor-args scripts/verify/meh-faucet-v1-args.js 0xEf4C3545edf08563bbC112D5CEf0A10B396Ea12E

npx hardhat verify --network base --constructor-args scripts/verify/meh-store-v1-args.js 0xFD6aF32884C7E79Fd26b4D1e8017D5D79B9266D9

```

