#!/bin/bash

# ============================================================
# Gameparty Release Script
# Automatisiert: Version bump, Git Push, Docker Build & Push
# ============================================================

set -e

echo "🚀 Starting Gameparty Release Process..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 1. Ensure git is clean
if [ -n "$(git status --porcelain)" ]; then
    echo -e "${RED}❌ Git working directory not clean. Commit changes first.${NC}"
    exit 1
fi

# 2. Get current version
CURRENT_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo -e "${YELLOW}Current version: $CURRENT_VERSION${NC}"

# 3. Bump version (patch)
echo "📝 Bumping version..."
npm version patch --no-git-tag-version

NEW_VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": "\(.*\)".*/\1/')
echo -e "${GREEN}✓ New version: $NEW_VERSION${NC}"

# 3.5. Update CHANGELOG
echo ""
echo "📝 Enter changelog entries for v$NEW_VERSION (one per line, empty line to finish):"
CHANGELOG_ENTRIES=""
while true; do
    read -p "  - " entry
    if [ -z "$entry" ]; then
        break
    fi
    CHANGELOG_ENTRIES="${CHANGELOG_ENTRIES}- ${entry}"$'\n'
done

if [ -z "$CHANGELOG_ENTRIES" ]; then
    echo -e "${YELLOW}⚠️  No changelog entries provided, skipping changelog update${NC}"
else
    # Get current date
    RELEASE_DATE=$(date +%Y-%m-%d)

    # Create new changelog entry
    TEMP_CHANGELOG=$(mktemp)
    echo "## v$NEW_VERSION ($RELEASE_DATE)" > "$TEMP_CHANGELOG"
    echo "$CHANGELOG_ENTRIES" >> "$TEMP_CHANGELOG"
    echo "" >> "$TEMP_CHANGELOG"
    cat CHANGELOG.md >> "$TEMP_CHANGELOG"
    mv "$TEMP_CHANGELOG" CHANGELOG.md

    echo -e "${GREEN}✓ CHANGELOG.md updated${NC}"
fi

# 4. Create commit
echo "📦 Creating git commit..."
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release v$NEW_VERSION

Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"

# 5. Create tag
echo "🏷️  Creating git tag..."
git tag "v$NEW_VERSION"

# 6. Push to GitHub
echo "🌐 Pushing to GitHub..."
git push origin main
git push origin --tags

# 7. Build Docker image
echo "🐳 Building Docker image..."
docker build -t gameparty:latest -t "gameparty:$NEW_VERSION" .

# 8. Push to Docker (if DOCKER_USERNAME is set)
if [ -n "$DOCKER_USERNAME" ]; then
    echo "📤 Pushing to Docker Hub..."
    docker tag "gameparty:$NEW_VERSION" "$DOCKER_USERNAME/gameparty:$NEW_VERSION"
    docker tag "gameparty:latest" "$DOCKER_USERNAME/gameparty:latest"
    docker push "$DOCKER_USERNAME/gameparty:$NEW_VERSION"
    docker push "$DOCKER_USERNAME/gameparty:latest"
    echo -e "${GREEN}✓ Docker pushed to $DOCKER_USERNAME/gameparty${NC}"
else
    echo -e "${YELLOW}⚠️  DOCKER_USERNAME not set, skipping Docker Hub push${NC}"
fi

echo -e "${GREEN}✅ Release v$NEW_VERSION completed successfully!${NC}"
echo ""
echo "📊 Summary:"
echo "  - Version bumped: $CURRENT_VERSION → $NEW_VERSION"
echo "  - Git tag: v$NEW_VERSION"
echo "  - Docker image: gameparty:$NEW_VERSION"
