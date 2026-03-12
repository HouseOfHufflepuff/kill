"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("killAPI", {
  generateWallet: ()        => ipcRenderer.invoke("generate-wallet"),
  importWallet:   (input)   => ipcRenderer.invoke("import-wallet", input),
  startAgent:     (strat)   => ipcRenderer.invoke("start-agent", strat),
  stopAgent:      ()        => ipcRenderer.invoke("stop-agent"),
  getBalances:    ()        => ipcRenderer.invoke("get-balances"),
  getStrategies:  ()        => ipcRenderer.invoke("get-strategies"),
  getConfig:      ()        => ipcRenderer.invoke("get-config"),
  saveConfig:     (data)    => ipcRenderer.invoke("save-config", data),
  onWalletLoaded: (cb)      => ipcRenderer.on("wallet-loaded",   (_e, d) => cb(d)),
  onAgentTick:    (cb)      => ipcRenderer.on("agent-tick",       (_e, d) => cb(d)),
  onAgentSections:(cb)      => ipcRenderer.on("agent-sections",   (_e, d) => cb(d)),
  onAgentStatus:  (cb)      => ipcRenderer.on("agent-status",     (_e, d) => cb(d)),
  onAgentError:    (cb)      => ipcRenderer.on("agent-error",      (_e, d) => cb(d)),
  onAgentUnfunded: (cb)      => ipcRenderer.on("agent-unfunded",   (_e, d) => cb(d)),
  onAgentAirdrop:  (cb)      => ipcRenderer.on("agent-airdrop",    (_e, d) => cb(d)),
  onBlockScan:     (cb)      => ipcRenderer.on("block-scan",       (_e, d) => cb(d)),
  openExternal:    (url)     => ipcRenderer.invoke("open-external", url),
});
