# Deploying the `rad` fork

This page applies to the `rad` branch of the RAD Digital Solutions fork only. It
replaces the official nightly on our own machines with a build of `rad`. The
upstream release workflow is in [release.md](./release.md).

The Linux hosts run the normal `t3` service. We install our build through
`t3 update` from a private feed, so `t3 service`, the database backup and the
automatic rollback on a failed start continue to work. The Mac runs only the
desktop app, which we build on the Mac.

## Version number

Use the `preview` shape: `<base>-preview.<YYYYMMDD>.<n>`, for example
`0.1.8-preview.20261107.1`. Use the base version of the current nightly.

T3 Code gives preview builds no update feed and never offers them as updates.
Thus the nightly does not replace our build. A preview version also sorts
above the nightly with the same base version, so no `--allow-downgrade` is
necessary.

## Build the Linux archive

Build in a separate worktree, because the version step changes every
`package.json`. You need `vp`, `cargo` and `patchelf`. If `patchelf` is not
installed, `uv tool install patchelf` installs it without sudo.

```sh
V=0.1.8-preview.20261107.1
git worktree add --detach ../t3code-rad-build rad   # or: git -C ../t3code-rad-build checkout --detach rad
cd ../t3code-rad-build
vp i
node scripts/update-release-package-versions.ts "$V"
vp run build:desktop:bundle
node apps/server/scripts/cli.ts build-exe --verbose
cargo build --locked --release --manifest-path native/resource-monitor/Cargo.toml
mkdir -p ../t3-rad-feed/rm/linux-x64
cp native/resource-monitor/target/release/t3-resource-monitor ../t3-rad-feed/rm/linux-x64/
node scripts/build-cli-archive.ts --platform linux --arch x64 --version "$V" \
  --resource-monitor-dir ../t3-rad-feed/rm --output-dir ../t3-rad-feed/out
```

Make sure that the extracted binary reports the correct version:

```sh
tar -xzf ../t3-rad-feed/out/t3-$V-linux-x64.tar.gz -C /tmp
/tmp/t3-$V-linux-x64/t3 --version   # t3 v<V>
```

## Make the feed

`t3 update` reads a feed with the same layout as the GitHub release downloads:

```sh
cd ../t3-rad-feed
mkdir -p feed/v$V
cp out/t3-$V-linux-x64.tar.gz feed/v$V/
(cd feed/v$V && sha256sum t3-$V-linux-x64.tar.gz > SHA256SUMS)
```

To install on another host, copy the feed to it first. Then each host serves
the feed on `127.0.0.1` only, and no port opens on the network:

```sh
scp -r feed <user>@<host>:t3-rad-feed
ssh <user>@<host> 'cd ~/t3-rad-feed/v'"$V"' && sha256sum -c SHA256SUMS'
```

## Install on a host

Restarting the service stops all agent turns, terminals and remote clients on
that host. Make sure nothing important is running first.

```sh
cd ~/t3-rad-feed   # the folder that contains v<V>/
python3 -m http.server 18765 --bind 127.0.0.1 &
SERVER_PID=$!
T3CODE_RELEASE_BASE_URL=http://127.0.0.1:18765 t3 update "$V" --yes
kill "$SERVER_PID"
```

`t3 update` asks you to confirm a preview build in a terminal, even with
`--yes`. When you run it without a terminal, for example through a
non-interactive SSH command, wrap it in `script` and send the answer:

```sh
(sleep 3; printf 'y\r'; sleep 300) | T3CODE_RELEASE_BASE_URL=http://127.0.0.1:18765 \
  script -qec "t3 update $V --yes" /dev/null
```

Then make sure that the service runs the new version:

```sh
t3 --version
t3 service status
```

## Build the Mac desktop app

Do this on the Mac, after you push `rad` to the fork. Use the same version
number as the servers. The Mac keeps a permanent checkout of the fork. Clone it
one time only:

```sh
git clone https://github.com/mihnearad/t3code.git <checkout> && git -C <checkout> checkout rad
```

For each update, set `T3_DIR` and `V` and paste the script below into the
terminal. It pulls `rad`, builds the `.dmg`, quits the app, moves the installed
app to `~/T3-app-backup`, installs the new app in `/Applications` and opens it.

```sh
T3_DIR=<checkout>
V=0.1.8-preview.20261108.1
(
set -euo pipefail
cd "$T3_DIR"
git restore . && git checkout rad && git pull --ff-only origin rad
vp i
node scripts/update-release-package-versions.ts "$V"
vp run build:desktop:bundle
vp run dist:desktop:dmg:arm64
DMG="release/T3-Code-$V-arm64.dmg"; [ -f "$DMG" ]
MNT=$(hdiutil attach "$DMG" -nobrowse | grep -o '/Volumes/.*' | head -1); [ -d "$MNT" ]
APP=$(ls -d "$MNT"/*.app | head -1); NAME=$(basename "$APP"); [ -n "$NAME" ] && [ -d "$APP" ]
osascript -e "quit app \"${NAME%.app}\"" || true; sleep 2
mkdir -p ~/T3-app-backup && rm -rf ~/T3-app-backup/"$NAME"
[ -d "/Applications/$NAME" ] && mv "/Applications/$NAME" ~/T3-app-backup/
ditto "$APP" "/Applications/$NAME"
hdiutil detach "$MNT"
xattr -cr "/Applications/$NAME"
open "/Applications/$NAME"
)
```

Obey these rules when you change the script:

- Keep `set -euo pipefail` in the subshell, and keep the checks before the
  lines that change `/Applications`. Without them, a failed step leaves
  `$NAME` empty and the next lines operate on `/Applications` itself.
- `git restore .` discards all uncommitted changes in the checkout. The
  version step changes every `package.json` and the next pull fails if these
  changes stay. Do not edit files by hand in this checkout.
- A preview version builds an app named `T3 Code (Beta).app`. A nightly build
  is named `T3 Code (Nightly).app`, so the two can stay in `/Applications`
  together.
- The `hdiutil` deprecation warnings have no effect on the result.

The build is not signed. If macOS blocks the first launch, right-click the app,
then select Open. To go back to the previous build, quit the app and move it
back from `~/T3-app-backup` to `/Applications`.

## Roll back to the nightly

`t3 update` removes the old version folders, so a rollback downloads the
nightly again from GitHub:

```sh
t3 update --channel nightly --allow-downgrade
```

On the Mac, quit `T3 Code (Beta)` and open `T3 Code (Nightly)`. If you removed
the nightly app, download it again from the GitHub releases page.
