"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("killAPI", {
  generateWallet: ()        => ipcRenderer.invoke("generate-wallet"),
  importWallet:   (input)   => ipcRenderer.invoke("import-wallet", input),
  startAgent:     (strat)   => ipcRenderer.invoke("start-agent", strat),
  stopAgent:      ()        => ipcRenderer.invoke("stop-agent"),
  getStrategies:  ()        => ipcRenderer.invoke("get-strategies"),
  onWalletLoaded: (cb)      => ipcRenderer.on("wallet-loaded",   (_e, d) => cb(d)),
  onAgentTick:    (cb)      => ipcRenderer.on("agent-tick",       (_e, d) => cb(d)),
  onAgentSections:(cb)      => ipcRenderer.on("agent-sections",   (_e, d) => cb(d)),
  onAgentStatus:  (cb)      => ipcRenderer.on("agent-status",     (_e, d) => cb(d)),
  onAgentError:   (cb)      => ipcRenderer.on("agent-error",      (_e, d) => cb(d)),
});
