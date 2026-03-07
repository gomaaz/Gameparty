#!/bin/bash
# Auto-commit mit Versions-Bump, CHANGELOG-Eintrag, git commit + tag
# Verwendung: bash scripts/commit.sh "feat: kurze Beschreibung"

set -e

MESSAGE="${1:-chore: update}"
VERSION_FILE="VERSION"
CHANGELOG_FILE="CHANGELOG.md"

# Aktuelle Version lesen
CURRENT=$(cat "$VERSION_FILE" | tr -d '[:space:]')

# Versions-Parsing: X.Y oder X.Y.Z
if [[ "$CURRENT" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
    MAJOR="${BASH_REMATCH[1]}"
    MINOR="${BASH_REMATCH[2]}"
    PATCH="${BASH_REMATCH[3]}"
    NEW_VERSION="$MAJOR.$MINOR.$((PATCH + 1))"
elif [[ "$CURRENT" =~ ^([0-9]+)\.([0-9]+)$ ]]; then
    MAJOR="${BASH_REMATCH[1]}"
    MINOR="${BASH_REMATCH[2]}"
    NEW_VERSION="$MAJOR.$MINOR.1"
else
    NEW_VERSION="${CURRENT}.1"
fi

DATE=$(date +%Y-%m-%d)

# VERSION-Datei aktualisieren
echo "$NEW_VERSION" > "$VERSION_FILE"

# CHANGELOG-Eintrag vorne einfügen
ENTRY="## v$NEW_VERSION ($DATE)\n- $MESSAGE\n"
if [ -f "$CHANGELOG_FILE" ]; then
    # Eintrag vor dem ersten ## einfügen (nach Header)
    TMPFILE=$(mktemp)
    awk -v entry="$ENTRY" '
        /^## / && !done { print entry; done=1 }
        { print }
    ' "$CHANGELOG_FILE" > "$TMPFILE"
    # Falls kein ## gefunden (leere Datei oder nur Header), anhängen
    if ! grep -q "^## v$NEW_VERSION" "$TMPFILE" 2>/dev/null; then
        echo -e "$ENTRY" >> "$CHANGELOG_FILE"
    else
        mv "$TMPFILE" "$CHANGELOG_FILE"
    fi
    rm -f "$TMPFILE"
else
    echo -e "# Changelog\n\n$ENTRY" > "$CHANGELOG_FILE"
fi

# Git commit + tag
git add -A
git commit -m "$MESSAGE"
git tag "v$NEW_VERSION"

echo ""
echo "✅ v$NEW_VERSION committed: $MESSAGE"
echo "🏷️  Tag: v$NEW_VERSION"
