#!/usr/bin/env bash
# Human-in-the-loop reproduction loop.
# Copy this file to a throwaway path, edit the steps below, and run it when an
# agent-runnable repro is impossible.

set -euo pipefail

step() {
  printf '\n>>> %s\n' "$1"
  read -r -p " [Enter when done] " _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  read -r -p " > " answer
  printf -v "$var" '%s' "$answer"
}

# --- edit below ---------------------------------------------------------

step "Open the app or environment that reproduces the issue."

capture REPRODUCED "Did the user-visible symptom reproduce? (y/n)"

capture SYMPTOM "Paste the exact redacted symptom, error, timing, or wrong output:"

# --- edit above ---------------------------------------------------------

printf '\n--- Captured ---\n'
printf 'REPRODUCED=%s\n' "$REPRODUCED"
printf 'SYMPTOM=%s\n' "$SYMPTOM"
