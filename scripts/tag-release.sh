#!/usr/bin/env bash
set -e

VERSION=$(node -e "console.log(require('./package.json').version)")

git tag "v${VERSION}"
git tag "mcp-v${VERSION}"
git tag "registry-v${VERSION}"
git push origin "v${VERSION}" "mcp-v${VERSION}" "registry-v${VERSION}"

echo "Tagged and pushed v${VERSION}, mcp-v${VERSION}, registry-v${VERSION}"
