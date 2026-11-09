# Git graph surface

- Status: Planned
- Started: 09/11/2026
- Design: Claude Design canvas "T3 Code Git Graph" (private, ask the owner
  for access)

## Goal

A read-only, visual view of the repository, like the Git log in JetBrains IDEs
and Git Graph in Visual Studio. You see the branches, the commits as a graph
with lanes, the worktrees, and which thread owns each worktree.

## Where it lives

A new **Git graph** entry in the right panel launcher ("Open a surface"),
after Diff, with the shortcut `G`. No other surface uses `G` now. It opens as a
surface tab like the others, and it is available for a project thread in a git
repository.

## Layout

When the right panel is maximized or wide, the surface has three columns:

1. **Refs** (left): groups _Worktrees_, _Local branches_, _Remote branches_,
   _Tags_. Each branch row shows ahead/behind counts against its upstream. A
   worktree row shows its branch, its folder, the count of uncommitted files,
   and the thread that owns it. Click a ref to scroll to its tip. Click the
   thread name to open the thread.
2. **Graph** (centre): one row per commit. Columns: graph lanes (one colour per
   branch), ref badges (HEAD, branch, remote branch, tag, worktree), subject,
   author, relative date, short hash. Uncommitted changes of a worktree show as
   a dashed node above its branch tip.
3. **Commit details** (right): ref badges, subject, message, commit, parents,
   author, date, the branches that contain it, and the changed files with
   +/- counts. **Open in Diff** opens the commit in the Diff surface through
   the existing **Commits** source.

When the panel is narrow (the default width), the refs become one select at the
top and the details become a bottom card.

Toolbar: branch select (all, current, one branch), author select, search on
subject and hash, and a "First parent" toggle.

## Design language

Use the existing web components and tokens only. No new look.

| Part                     | Component or source                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Surface tab and launcher | `RightPanelTabs.tsx` (tab `h-6 rounded-md text-xs`, launcher row with `Kbd`)                                                        |
| Icon                     | lucide `GitGraph`                                                                                                                   |
| Toolbar                  | `Select` size `sm`, `Input` size `compact` type `search`, `Toggle`                                                                  |
| Ref badges               | `Badge` size `sm`: `default` for HEAD, `outline` for local branches, `secondary` for remote branches and tags, `info` for worktrees |
| Ahead and behind         | `text-success-foreground` and `text-warning-foreground`, `tabular-nums`                                                             |
| Rows                     | the commit rows of the Diff panel's Commits menu (`hover:bg-accent`, selected `bg-foreground/[0.08]`)                               |
| Section headers          | `collapsible-section-header.tsx`                                                                                                    |
| Details card             | the thread details card (`bg-card`, `border`, `rounded-xl`)                                                                         |
| Actions                  | `Button` variant `outline` size `xs`                                                                                                |
| Long paths and branches  | `MiddleTruncate`, `Tooltip` for the full subject                                                                                    |
| Lists                    | `ScrollArea` with a virtualized list                                                                                                |

Lane colours come from the Tailwind 400 palette that the theme already uses
(blue, emerald, amber, violet, pink), so they work in light and dark themes.

## Scope (version 1)

- Read-only. No checkout, reset, rebase, cherry-pick or branch delete from the
  graph. The branch picker and git actions stay the way to change state.
- The first 500 commits in topological order, then load more by page.
- Live update: the graph refreshes when `subscribeVcsStatus` reports a change
  (commit, fetch, branch switch), not on a timer.
- Web and desktop.
- Git only. Other VCS drivers show "not supported".

## Out of scope (version 1)

- **Mobile.** Postponed, because we cannot install the fork's app on iPhone
  yet. The contracts and the layout function are shared, so mobile can follow
  later.
- Write actions from the graph. A later version can add a row menu that calls
  the existing service methods.
- Fetch from the graph. The existing pull action stays.
- Blame and file history.
- Graphs that join several repositories.

## Server and contracts

- `packages/contracts`: a new `vcs.getGraph` RPC. Input: environment, project
  or thread cwd, ref filter, cursor, page size. Output: commits (hash, parents,
  author, date, subject, ref names) and a cursor. A second RPC
  `vcs.getRepositoryRefs` returns branches, remote branches, tags, and
  worktrees with path, branch, dirty state and ahead/behind.
- `apps/server/src/vcs`: one service method per RPC in the git driver. It runs
  `git log --topo-order --format=... -z` and `git worktree list --porcelain -z`
  (the driver already reads worktrees). Map each worktree path to the thread
  that uses it from the projection, not from git.
- The server sends raw commits and parents only. The client computes the lane
  layout. This keeps the payload small and the server simple.
- Add the new read methods to `CLIENT_GUARDED_RPC_SCOPES` with a read scope.
- No MCP tool in version 1. Agents already run git.

## Client

- `apps/web`: a new `git-graph` kind in `rightPanelStore.ts`, a launcher entry
  in `RightPanelTabs.tsx`, and a surface component under
  `apps/web/src/components/gitGraph/`.
- Lane layout as a pure function in `packages/client-runtime`, so mobile can
  use it later. Unit tests for merges, octopus merges, branch ends and paging.
- Virtualized list. Draw lanes with one SVG per visible row, no canvas and no
  animation, so scrolling 10,000 commits stays smooth.

## Performance and remote

- The page size limits the payload over the WebSocket. No full history
  download.
- The layout runs on the client, so a remote or T3 Connect server only runs
  `git log` once per page.
- All paths come from the server, so the graph is correct for a remote
  environment.

## Risks

- Very large repositories: `git log --topo-order` can be slow on the first
  page. Mitigation: use `--date-order` when the commit-graph file is missing,
  and cap the time.
- Upstream conflicts: the right panel files change often upstream. Keep our
  changes small and in new files, so merges stay easy.
- Lane layout bugs on unusual histories. Mitigation: tests with real histories
  copied from our repositories.

## Rollback

The feature is additive. To remove it, revert its commits on `rad`. No
database migration is part of version 1.

## Next steps

1. Review the design and this plan.
2. Build the contracts and the server methods with tests, then the web
   surface.
3. Verify in a real client with `test-t3-app`, then deploy with the normal
   `rad` steps.
