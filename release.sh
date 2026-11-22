#!/bin/bash
# Release from the dev PC (Git Bash, local gh login; no token is stored in this public repository):
# 1. starts the GitHub Actions build of the pushed HEAD and waits for it (release build-N of this repository);
# 2. downloads the APK to build/apk;
# 3. unless "build" is given, offers it to the installed apps (Updater.kt): release firegames-N of the public
#    repository mefistofelix/firetv-apps plus firegames.json there, the same scheme as the other Fire TV apps.
# usage: bash release.sh [build]        (after git push)
set -e
cd "$(dirname "$0")"
REPO=mefistofelix/FireGames
APPS_REPO=mefistofelix/firetv-apps

git fetch -q origin
git merge-base --is-ancestor HEAD "@{u}" || { echo "push HEAD first (git push)"; exit 2; }
SHA=$(git rev-parse HEAD)
STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
gh workflow run ci.yml -R "$REPO" --ref "$(git rev-parse --abbrev-ref HEAD)"

# the run takes a few seconds to appear
RUN=""
for attempt in $(seq 1 30); do
  RUN=$(gh run list -R "$REPO" --workflow ci.yml -L 10 --json databaseId,headSha,createdAt \
    -q "[.[] | select(.headSha==\"$SHA\" and .createdAt>=\"$STARTED\")][0].databaseId")
  [ -n "$RUN" ] && break
  sleep 3
done
[ -n "$RUN" ] || { echo "no Actions run for $SHA"; exit 1; }
gh run watch "$RUN" -R "$REPO" --exit-status > /dev/null || { echo "build failed: gh run view $RUN -R $REPO --log-failed"; exit 1; }

N=$(gh run view "$RUN" -R "$REPO" --json number -q .number)
NAME="FireGames-$N.apk"
APK="build/apk/$NAME"
mkdir -p build/apk
gh release download "build-$N" -R "$REPO" -p "$NAME" -D build/apk --clobber
echo "built $APK"
[ "$1" = "build" ] && exit 0

gh release create "firegames-$N" "$APK" -R "$APPS_REPO" --title "Fire Games 0.1.$N" --notes "Fire Games build $N" --latest=false ||
  gh release upload "firegames-$N" "$APK" -R "$APPS_REPO" --clobber
URL="https://github.com/$APPS_REPO/releases/download/firegames-$N/$NAME"
SHA256=$(sha256sum "$APK" | cut -d' ' -f1)
SIZE=$(stat -c %s "$APK")
MANIFEST=$(printf '{"versionCode": %s, "versionName": "0.1.%s", "url": "%s", "sha256": "%s", "size": %s}\n' "$N" "$N" "$URL" "$SHA256" "$SIZE")
OLD=$(gh api "repos/$APPS_REPO/contents/firegames.json" -q .sha 2>/dev/null || true)
gh api -X PUT "repos/$APPS_REPO/contents/firegames.json" -f message="Fire Games build $N" \
  -f content="$(printf '%s' "$MANIFEST" | base64 -w0)" ${OLD:+-f sha="$OLD"} > /dev/null
echo "update offered: $URL"
