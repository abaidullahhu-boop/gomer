#!/usr/bin/env bash
# Print what production is currently serving: <phase> <short commit>.
#
# Compare against `git rev-parse --short HEAD` before recording a demo — a push
# takes a few minutes to go live, and filming against the previous build is the
# easiest way to record behaviour you already fixed.
#
# Uses the DO API directly rather than `doctl`, which is installed via snap here
# and fails with a confinement error.
set -euo pipefail

APP_ID=a193439a-bad8-47f5-9843-60751e9b7a71
TOKEN=$(grep -m1 'access-token' ~/.config/doctl/config.yaml | awk '{print $2}')

curl -fsS -H "Authorization: Bearer $TOKEN" \
  "https://api.digitalocean.com/v2/apps/${APP_ID}/deployments?per_page=1" |
  python3 -c "
import json, sys
d = json.load(sys.stdin)['deployments'][0]
print(d['phase'], d['services'][0].get('source_commit_hash', '?')[:7])
"
