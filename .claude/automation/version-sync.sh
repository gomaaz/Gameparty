#!/bin/bash

# ============================================================
# Auto Version Sync Script
# Wird nach jeder Änderung ausgeführt um zu GitHub zu pushen
# ============================================================

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$PROJECT_DIR"

echo "🔄 Syncing with GitHub..."

# Check if there are changes
if [ -z "$(git status --porcelain)" ]; then
    echo "✓ No changes to sync"
    exit 0
fi

# Get current version
VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')

# Check if already on latest tag
LATEST_TAG=$(git describe --tags --abbrev=0 2>/dev/null || echo "v0.0.0")
if [ "$LATEST_TAG" = "v$VERSION" ]; then
    echo "✓ Already at version $VERSION, skipping tag creation"
else
    echo "📝 Creating tag v$VERSION"
    git tag "v$VERSION"
fi

# Push with retry logic (for SSH issues)
MAX_RETRIES=3
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if git push origin main && git push origin --tags; then
        echo -e "\033[0;32m✓ Pushed to GitHub successfully\033[0m"
        exit 0
    else
        RETRY_COUNT=$((RETRY_COUNT + 1))
        if [ $RETRY_COUNT -lt $MAX_RETRIES ]; then
            echo "⚠️  Push failed, retrying in 5 seconds... ($RETRY_COUNT/$MAX_RETRIES)"
            sleep 5
        fi
    fi
done

echo -e "\033[0;31m❌ Failed to push after $MAX_RETRIES attempts\033[0m"
echo "Please check your SSH keys and network connection"
exit 1
