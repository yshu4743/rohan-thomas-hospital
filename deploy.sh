#!/usr/bin/env bash
# Publish the page. Run after editing index.html.
set -euo pipefail
cd "$(dirname "$0")"
git add -A
git commit -m "update hospital page" || { echo "Nothing to commit."; exit 0; }
git push
echo
echo "Pushed. Live in ~1 minute at:"
echo "  https://yshu4743.github.io/rohan-thomas-hospital/"
