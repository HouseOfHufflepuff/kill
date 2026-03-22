#!/bin/bash
# KILLGame Agent — Developer Install (Solana + Base)
# Usage: mkdir killgame && cd killgame && curl -fsSL https://killgame.ai/kill.sh | bash

set -e

REPO="https://github.com/HouseOfHufflepuff/kill.git"
INSTALL_DIR="$(pwd)"
DESKTOP_DIR="$INSTALL_DIR/agents/desktop"

# ── Colors ────────────────────────────────────────────────────────────────────
C_PURPLE="\033[0;35m"
C_GREEN="\033[0;32m"
C_CYAN="\033[0;36m"
C_GRAY="\033[0;90m"
C_RESET="\033[0m"
C_BOLD="\033[1m"

print_header() {
  echo ""
  echo -e "${C_PURPLE}${C_BOLD}  ██╗  ██╗██╗██╗     ██╗      ██████╗  █████╗ ███╗   ███╗███████╗${C_RESET}"
  echo -e "${C_PURPLE}${C_BOLD}  ██║ ██╔╝██║██║     ██║     ██╔════╝ ██╔══██╗████╗ ████║██╔════╝${C_RESET}"
  echo -e "${C_PURPLE}${C_BOLD}  █████╔╝ ██║██║     ██║     ██║  ███╗███████║██╔████╔██║█████╗  ${C_RESET}"
  echo -e "${C_PURPLE}${C_BOLD}  ██╔═██╗ ██║██║     ██║     ██║   ██║██╔══██║██║╚██╔╝██║██╔══╝  ${C_RESET}"
  echo -e "${C_PURPLE}${C_BOLD}  ██║  ██╗██║███████╗███████╗╚██████╔╝██║  ██║██║ ╚═╝ ██║███████╗${C_RESET}"
  echo -e "${C_PURPLE}${C_BOLD}  ╚═╝  ╚═╝╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝     ╚═╝╚══════╝${C_RESET}"
  echo ""
  echo -e "${C_GRAY}  Developer Install — Solana + Base${C_RESET}"
  echo ""
}

step() { echo -e "${C_CYAN}[${1}]${C_RESET} ${2}"; }
ok()   { echo -e "${C_GREEN}  ✓${C_RESET} ${1}"; }
warn() { echo -e "\033[0;33m  ⚠${C_RESET} ${1}"; }
die()  { echo -e "\033[0;31m  ✗${C_RESET} ${1}"; exit 1; }

# ── Preflight ─────────────────────────────────────────────────────────────────
print_header

step "1/4" "Checking prerequisites..."

command -v node >/dev/null 2>&1 || die "Node.js not found. Install from https://nodejs.org (v18+)"
command -v npm  >/dev/null 2>&1 || die "npm not found. Install Node.js from https://nodejs.org"
command -v git  >/dev/null 2>&1 || die "git not found. Install git first."

NODE_VERSION=$(node -e "process.stdout.write(process.version.slice(1).split('.')[0])")
[ "$NODE_VERSION" -lt 18 ] 2>/dev/null && warn "Node.js v18+ recommended (found v${NODE_VERSION})"

ok "Node $(node --version), npm $(npm --version), git $(git --version | awk '{print $3}')"

# ── Sparse clone (agents/ only) ──────────────────────────────────────────────
step "2/4" "Installing source..."

if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "${C_GRAY}  Existing install found — pulling latest...${C_RESET}"
  git -C "$INSTALL_DIR" fetch --quiet origin
  git -C "$INSTALL_DIR" reset --hard origin/main --quiet
  ok "Updated $INSTALL_DIR"
else
  echo -e "${C_GRAY}  Fetching agents into $(pwd) ...${C_RESET}"
  git init --quiet
  git remote add origin "$REPO"
  git config core.sparseCheckout true
  echo "agents/" > .git/info/sparse-checkout
  git fetch --quiet --depth=1 origin main
  git checkout --quiet main
  ok "Installed to $INSTALL_DIR"
fi

# ── npm install (desktop app — includes Solana + Base deps) ───────────────────
step "3/4" "Installing dependencies..."

echo -e "${C_GRAY}  Installing desktop app dependencies...${C_RESET}"
(cd "$DESKTOP_DIR" && npm install --quiet 2>/dev/null)
ok "Dependencies installed"

# ── Launch ────────────────────────────────────────────────────────────────────
step "4/4" "Launching KILLGame..."

echo ""
echo -e "${C_GREEN}${C_BOLD}  Installation complete.${C_RESET}"
echo ""
echo -e "  ${C_GRAY}Source installed at: $INSTALL_DIR/agents${C_RESET}"
echo -e "  ${C_GRAY}To relaunch:  cd $INSTALL_DIR/agents/desktop && npm start${C_RESET}"
echo -e "  ${C_GRAY}With DevTools: cd $INSTALL_DIR/agents/desktop && NODE_ENV=development npm start${C_RESET}"
echo -e "  ${C_GRAY}To update:    cd $INSTALL_DIR && git pull${C_RESET}"
echo ""

cd "$DESKTOP_DIR" && exec npm start --silent
