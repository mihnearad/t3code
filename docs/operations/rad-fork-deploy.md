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

Do this on the Mac, from a checkout of `rad` that is pushed to the fork. Use the
same version number as the servers.

```sh
git clone https://github.com/mihnearad/t3code.git && cd t3code && git checkout rad
vp i
node scripts/update-release-package-versions.ts "$V"
vp run build:desktop:bundle
vp run dist:desktop:dmg:arm64
```

Quit the nightly app and move it out of `/Applications` to a backup folder.
Then install the `.dmg` from `release/`. The build is not signed, so the first
launch needs right-click, then Open.

## Roll back to the nightly

`t3 update` removes the old version folders, so a rollback downloads the
nightly again from GitHub:

```sh
t3 update --channel nightly --allow-downgrade
```

On the Mac, put the nightly app back from the backup folder.
