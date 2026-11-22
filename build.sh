#!/bin/bash
# Builds the Fire TV APK: build/apk/FireGames-N.apk, N = BUILD_NUMBER (versionCode; the GitHub run number on CI).
# Needs a JDK 17 and the Android SDK (ANDROID_HOME), as on GitHub-hosted runners; Gradle is downloaded to tools/.
set -e
cd "$(dirname "$0")"

export BUILD_NUMBER="${BUILD_NUMBER:-${GITHUB_RUN_NUMBER:-0}}"
if [ -n "$JAVA_HOME_17_X64" ]; then
  export JAVA_HOME="$JAVA_HOME_17_X64"
fi

GRADLE_VERSION=8.9
GRADLE="tools/gradle-$GRADLE_VERSION/bin/gradle"
if [ ! -x "$GRADLE" ]; then
  mkdir -p tools
  curl -fsSL -o tools/gradle.zip "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip"
  unzip -q tools/gradle.zip -d tools
  rm tools/gradle.zip
fi

"$GRADLE" --no-daemon --project-cache-dir build/gradle-cache assembleRelease
mkdir -p build/apk
cp build/gradle/outputs/apk/release/*.apk "build/apk/FireGames-$BUILD_NUMBER.apk"
echo "built build/apk/FireGames-$BUILD_NUMBER.apk"
