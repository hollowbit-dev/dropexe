#!/bin/sh
# Builds the Apple Silicon .dmg and publishes it as a GitHub release. Run: bash scripts/release.sh
set -e
cd "$(dirname "$0")/.."
V=$(node -p "require('./package.json').version")
npx electron-builder --mac --arm64 --publish never
gh release create "v$V" "dist/DropExe-$V-mac-arm64.dmg" --repo hollowbit-dev/dropexe --title "DropExe $V" \
  --notes "First release. Windows games on your Mac, free: one shelf for Steam, Windows and Mac games, one-click Steam and Epic, drop any .exe, Make it run, Launchpad apps. Apple Silicon only. Right-click > Open the first time."
echo "Released v$V"
