#!/bin/bash
# KILLGame Agent — Developer Install
# Usage: curl -fsSL https://killgame.ai/kill.sh | bash

set -e

REPO="https://github.com/HouseOfHufflepuff/kill.git"
INSTALL_DIR="$HOME/.killgame"
DESKTOP_DIR="$INSTALL_DIR/agents/sol/desktop"
BIN_DIR="$HOME/.local/bin"
CMD_NAME="killgame"

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
  echo -e "${C_GRAY}  Solana Agent — Developer Install${C_RESET}"
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

# ── Clone or update ───────────────────────────────────────────────────────────
step "2/4" "Installing source..."

if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "${C_GRAY}  Existing install found — pulling latest...${C_RESET}"
  git -C "$INSTALL_DIR" pull --quiet
  ok "Updated $INSTALL_DIR"
else
  echo -e "${C_GRAY}  Cloning to $INSTALL_DIR ...${C_RESET}"
  git clone --quiet "$REPO" "$INSTALL_DIR"
  ok "Cloned to $INSTALL_DIR"
fi

# ── npm install ───────────────────────────────────────────────────────────────
step "3/4" "Installing dependencies..."

(cd "$DESKTOP_DIR" && npm install --quiet 2>/dev/null)
ok "Dependencies installed"

# ── Write killgame command ────────────────────────────────────────────────────
step "4/4" "Installing ${CMD_NAME} command..."

mkdir -p "$BIN_DIR"

cat > "$BIN_DIR/$CMD_NAME" <<WRAPPER
#!/bin/bash
DESKTOP_DIR="$DESKTOP_DIR"
CMD="\${1:-help}"

case "\$CMD" in

  setup)
    # Open the app — setup screen appears automatically if no wallet is configured
    echo "Opening KILLGame setup..."
    cd "\$DESKTOP_DIR" && npm start --silent
    ;;

  start)
    # Open the app — goes straight to dashboard if wallet already exists
    echo "Starting KILLGame agent..."
    cd "\$DESKTOP_DIR" && npm start --silent
    ;;

  dev)
    # Launch with DevTools open for development
    echo "Starting KILLGame in developer mode..."
    cd "\$DESKTOP_DIR" && NODE_ENV=development npm start --silent
    ;;

  update)
    INSTALL_DIR="$INSTALL_DIR"
    echo "Pulling latest from GitHub..."
    git -C "\$INSTALL_DIR" pull
    echo "Updating dependencies..."
    cd "\$DESKTOP_DIR" && npm install --quiet
    echo "Done."
    ;;

  build)
    echo "Building distributable..."
    cd "\$DESKTOP_DIR" && npm run build
    ;;

  where)
    echo "\$DESKTOP_DIR"
    ;;

  help|--help|-h|*)
    echo ""
    echo "  killgame <command>"
    echo ""
    echo "  setup     Configure wallet and agent settings"
    echo "  start     Launch the agent GUI"
    echo "  dev       Launch with developer tools open"
    echo "  update    Pull latest source from GitHub"
    echo "  build     Build distributable DMG / EXE"
    echo "  where     Print install directory"
    echo ""
    echo "  Source: $INSTALL_DIR"
    echo ""
    ;;

esac
WRAPPER

chmod +x "$BIN_DIR/$CMD_NAME"
ok "Wrote $BIN_DIR/$CMD_NAME"

# ── PATH check ────────────────────────────────────────────────────────────────
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$BIN_DIR"; then
  echo ""
  warn "$BIN_DIR is not in your PATH."
  echo ""
  echo -e "${C_GRAY}  Add it by running:${C_RESET}"
  echo ""

  SHELL_RC="$HOME/.bashrc"
  [ -n "$ZSH_VERSION" ] && SHELL_RC="$HOME/.zshrc"
  [ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"

  echo "    echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> $SHELL_RC"
  echo "    source $SHELL_RC"
  echo ""
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${C_GREEN}${C_BOLD}  Installation complete.${C_RESET}"
echo ""
echo -e "  ${C_BOLD}killgame setup${C_RESET}   ${C_GRAY}— Create or import your Solana wallet${C_RESET}"
echo -e "  ${C_BOLD}killgame start${C_RESET}   ${C_GRAY}— Launch the agent${C_RESET}"
echo -e "  ${C_BOLD}killgame dev${C_RESET}     ${C_GRAY}— Launch with DevTools for development${C_RESET}"
echo -e "  ${C_BOLD}killgame update${C_RESET}  ${C_GRAY}— Pull latest source from GitHub${C_RESET}"
echo ""
echo -e "  ${C_GRAY}Source installed at: $INSTALL_DIR${C_RESET}"
echo -e "  ${C_GRAY}Agent UI:            $DESKTOP_DIR/index.html${C_RESET}"
echo -e "  ${C_GRAY}Capabilities:        $DESKTOP_DIR/agents/${C_RESET}"
echo ""
