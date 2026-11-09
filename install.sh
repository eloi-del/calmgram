#!/usr/bin/env bash
# Compile Calmgram, l'installe sur le téléphone branché en USB, et l'ouvre.
#   ./install.sh            -> ouvre l'appli
#   ./install.sh reglages   -> ouvre directement la page des réglages Calmgram
set -euo pipefail
cd "$(dirname "$0")"

./gradlew assembleDebug --console=plain -q

echo "En attente du téléphone (débogage USB autorisé)..."
adb wait-for-usb-device
adb install -r app/build/outputs/apk/debug/app-debug.apk

if [ "${1:-}" = "reglages" ]; then
  adb shell am start -a fr.perso.calmgram.SETTINGS -n fr.perso.calmgram/.MainActivity
else
  adb shell am start -n fr.perso.calmgram/.MainActivity
fi
