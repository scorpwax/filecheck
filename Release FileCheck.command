#!/bin/bash
# Release FileCheck: test, bump the version, update the changelog, commit, push, and tag.
# The tag makes GitHub Actions build, sign and notarize the DMG and publish the release,
# and copies of FileCheck pick it up through the in-app update banner.
# Double-click it in Finder (or run it in Terminal). It stops at the first failure, before
# anything is pushed. Try it safely with:  DRY=1 "./Release FileCheck.command"
#
# Version: if the version in package.json has no tag yet (already bumped by hand or by Claude),
# that version is released as-is. Otherwise it asks patch / minor / major and bumps it.

cd "$(dirname "$0")" || exit 1
export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
REPO_SLUG="scorpwax/filecheck"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() {
  printf '\n\033[31m✗ %s\033[0m\n' "$*"
  echo "Nothing was pushed."
  if [ -n "$BUMPED" ]; then
    git checkout -- package.json package-lock.json CHANGELOG.md 2>/dev/null && echo "(Version bump undone.)"
  fi
  read -n 1 -s -r -p "Press any key to close."
  exit 1
}
done_close() {
  echo
  read -n 1 -s -r -p "Press any key to close."
  exit 0
}
g() { if [ -n "$DRY" ]; then echo "  [dry run] git $*"; else git "$@"; fi; }

bold "FileCheck — release"
[ -n "$DRY" ] && echo "(dry run: nothing will be changed, committed or pushed)"
echo

[ "$(git rev-parse --abbrev-ref HEAD)" = "main" ] || fail "Switch to the main branch first."

# --- What's waiting? -------------------------------------------------------
CHANGES="$(git status --porcelain)"
UNPUSHED="$(git log --oneline @{u}..HEAD 2>/dev/null)"
CURRENT="$(node -p 'require("./package.json").version')"
TAGGED=
{ git rev-parse -q --verify "refs/tags/v$CURRENT" >/dev/null || [ -n "$(git ls-remote --tags origin "v$CURRENT" 2>/dev/null)" ]; } && TAGGED=1

if [ -z "$CHANGES" ] && [ -z "$UNPUSHED" ] && [ -n "$TAGGED" ]; then
  echo "Nothing to release — no changes, and v$CURRENT is already released."
  done_close
fi

if [ -n "$CHANGES" ]; then
  bold "Changes:"
  git status --short
  echo
fi

# --- Tests ---------------------------------------------------------------
bold "Tests"
npm test >/tmp/filecheck-release-test.log 2>&1 || fail "Tests failed (log: /tmp/filecheck-release-test.log)"
ok "passed"

# --- Version + description ----------------------------------------------
MESSAGE=
if [ -n "$TAGGED" ]; then
  # this version is already out, so a new one is needed
  read -r -p "What changed? (blank to cancel): " MESSAGE
  [ -z "$MESSAGE" ] && { echo "Cancelled."; done_close; }
  read -r -p "Version bump: [p]atch (fixes) / [m]inor (features) / [M]ajor? [p] " KIND
  case "$KIND" in
    M|major) BUMP=major ;;
    m|minor) BUMP=minor ;;
    *) BUMP=patch ;;
  esac
  if [ -z "$DRY" ]; then
    npm version "$BUMP" --no-git-tag-version >/dev/null || fail "Couldn't bump the version."
    BUMPED=1
  fi
  VERSION="$(node -p 'require("./package.json").version')"
  [ -n "$DRY" ] && VERSION="(next $BUMP after $CURRENT)"
  # changelog entry from the description
  if [ -z "$DRY" ]; then
    MSG="$MESSAGE" VER="$VERSION" node -e '
      const fs = require("fs");
      const s = fs.readFileSync("CHANGELOG.md", "utf8");
      const entry = `## [Unreleased]\n\n## [${process.env.VER}]\n\n- ${process.env.MSG}\n`;
      fs.writeFileSync("CHANGELOG.md", s.replace("## [Unreleased]\n", entry));
    ' || fail "Couldn't update CHANGELOG.md."
  fi
  ok "version $VERSION"
else
  VERSION="$CURRENT"
  ok "releasing v$VERSION (already bumped, not tagged yet)"
  grep -q "^## \[$VERSION\]" CHANGELOG.md || echo "  ! CHANGELOG.md has no entry for $VERSION — add one first if you want release notes."
  if [ -n "$CHANGES" ]; then
    read -r -p "Describe the uncommitted changes (blank to cancel): " MESSAGE
    [ -z "$MESSAGE" ] && { echo "Cancelled."; done_close; }
  fi
fi

echo
read -r -p "Publish FileCheck v$VERSION to everyone now? [y/N] " yn
[[ "$yn" =~ ^[Yy] ]] || fail "Cancelled before anything was pushed."

# --- Commit, push, tag -----------------------------------------------------
bold "Git"
if [ -n "$(git status --porcelain)" ] || [ -n "$BUMPED" ]; then
  g add -A
  g commit -q -m "v$VERSION — $MESSAGE" || fail "git commit failed."
  ok "committed: v$VERSION — $MESSAGE"
fi
g push -q origin main || fail "git push failed (network / GitHub access?). Your commit is saved locally — run this again."
ok "pushed main"
# the tag goes in its own push: pushing a branch and a tag together only starts the branch's build
g tag "v$VERSION" || fail "Couldn't create the tag v$VERSION."
g push -q origin "v$VERSION" || fail "Couldn't push the tag v$VERSION."
ok "pushed tag v$VERSION — GitHub is building the release"

[ -n "$DRY" ] && { echo; bold "Dry run finished."; done_close; }

# --- Wait for the release ----------------------------------------------------
echo
bold "Waiting for the build (about 5–10 minutes; Ctrl-C is safe, it keeps building)"
for i in $(seq 1 60); do
  RESP="$(curl -s -m 10 "https://api.github.com/repos/$REPO_SLUG/releases/tags/v$VERSION")"
  if printf '%s' "$RESP" | grep -q '"browser_download_url".*\.dmg'; then
    echo
    ok "v$VERSION is live: https://github.com/$REPO_SLUG/releases/tag/v$VERSION"
    echo "  Copies of FileCheck will show the update banner on their next launch (or when you click the version)."
    done_close
  fi
  printf '.'
  sleep 30
done
echo
echo "Still building after 30 minutes. Check: https://github.com/$REPO_SLUG/actions"
done_close
