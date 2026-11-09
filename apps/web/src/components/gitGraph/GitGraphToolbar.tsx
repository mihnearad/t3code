import {
  ChevronsDownUp,
  ChevronsUpDown,
  Cloud,
  Ellipsis,
  GitCommitVertical,
  type LucideIcon,
} from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { pathBasename } from "./gitGraph.logic";

function ToolbarIconToggle(props: {
  icon: LucideIcon;
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}) {
  const Icon = props.icon;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            aria-label={props.label}
            variant="ghost"
            size="sm"
            pressed={props.pressed}
            onPressedChange={(pressed) => props.onPressedChange(Boolean(pressed))}
          />
        }
      >
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup side="top">{props.label}</TooltipPopup>
    </Tooltip>
  );
}

export const ALL_BRANCHES = "all";
export const CURRENT_BRANCH = "current";
const ANY_AUTHOR = "__any__";
const WORKTREE_PREFIX = "worktree:";

export function GitGraphToolbar(props: {
  wide: boolean;
  branchValue: string;
  localBranches: ReadonlyArray<string>;
  worktreePaths: ReadonlyArray<string>;
  onBranchChange: (value: string) => void;
  onJumpToWorktree: (path: string) => void;
  authors: ReadonlyArray<string>;
  author: string | null;
  onAuthorChange: (author: string | null) => void;
  search: string;
  onSearchChange: (search: string) => void;
  firstParent: boolean;
  onFirstParentChange: (firstParent: boolean) => void;
  allRemoteBranches: boolean;
  onAllRemoteBranchesChange: (allRemoteBranches: boolean) => void;
  collapseLinear: boolean;
  onCollapseLinearChange: (collapseLinear: boolean) => void;
  /** Offered while at least one run is collapsed. */
  onExpandAll: (() => void) | null;
  loadedCount: number;
}) {
  const { wide } = props;
  const allLabel =
    !wide && props.worktreePaths.length > 0
      ? `All branches · ${props.worktreePaths.length} ${props.worktreePaths.length === 1 ? "worktree" : "worktrees"}`
      : "All branches";
  const branchItems = [
    { value: ALL_BRANCHES, label: allLabel },
    { value: CURRENT_BRANCH, label: "Current branch" },
    ...props.localBranches.map((name) => ({ value: name, label: name })),
  ];
  const authorItems = [
    { value: ANY_AUTHOR, label: "Any author" },
    ...props.authors.map((name) => ({ value: name, label: name })),
  ];
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border/60 px-2 py-1.5">
      <Select
        modal={false}
        value={props.branchValue}
        items={branchItems}
        onValueChange={(value) => {
          if (value === null) return;
          if (value.startsWith(WORKTREE_PREFIX))
            props.onJumpToWorktree(value.slice(WORKTREE_PREFIX.length));
          else props.onBranchChange(value);
        }}
      >
        <SelectTrigger size="sm" aria-label="Branches" className="w-auto min-w-0 max-w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup alignItemWithTrigger={false}>
          <SelectItem value={ALL_BRANCHES}>{allLabel}</SelectItem>
          <SelectItem value={CURRENT_BRANCH}>Current branch</SelectItem>
          {props.localBranches.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
          {!wide && props.worktreePaths.length > 0 ? (
            <SelectGroup>
              <SelectGroupLabel>Worktrees</SelectGroupLabel>
              {props.worktreePaths.map((path) => (
                <SelectItem key={path} value={`${WORKTREE_PREFIX}${path}`}>
                  {pathBasename(path)}
                </SelectItem>
              ))}
            </SelectGroup>
          ) : null}
        </SelectPopup>
      </Select>
      {wide ? (
        <Select
          modal={false}
          value={props.author ?? ANY_AUTHOR}
          items={authorItems}
          onValueChange={(value) =>
            props.onAuthorChange(value === null || value === ANY_AUTHOR ? null : value)
          }
        >
          <SelectTrigger size="sm" aria-label="Author" className="w-auto min-w-0 max-w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {authorItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      <Input
        type="search"
        size="compact"
        aria-label="Search message or hash"
        placeholder="Search message or hash"
        value={props.search}
        onChange={(event) => props.onSearchChange(event.target.value)}
        className="min-w-32 flex-1"
      />
      {wide ? (
        <>
          <ToolbarIconToggle
            icon={GitCommitVertical}
            label="First parent only"
            pressed={props.firstParent}
            onPressedChange={props.onFirstParentChange}
          />
          <ToolbarIconToggle
            icon={Cloud}
            label="All remote branches"
            pressed={props.allRemoteBranches}
            onPressedChange={props.onAllRemoteBranchesChange}
          />
          <ToolbarIconToggle
            icon={ChevronsDownUp}
            label="Collapse linear branches"
            pressed={props.collapseLinear}
            onPressedChange={props.onCollapseLinearChange}
          />
          {props.onExpandAll ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost-muted"
                    size="icon-xs"
                    aria-label="Expand all"
                    onClick={props.onExpandAll}
                  />
                }
              >
                <ChevronsUpDown />
              </TooltipTrigger>
              <TooltipPopup side="top">Expand all</TooltipPopup>
            </Tooltip>
          ) : null}
        </>
      ) : (
        <Menu>
          <MenuTrigger
            render={<Button variant="ghost-muted" size="icon-xs" aria-label="More filters" />}
          >
            <Ellipsis />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuGroupLabel>Author</MenuGroupLabel>
              <MenuRadioGroup
                value={props.author ?? ANY_AUTHOR}
                onValueChange={(value) =>
                  props.onAuthorChange(value === ANY_AUTHOR ? null : String(value))
                }
              >
                {authorItems.map((item) => (
                  <MenuRadioItem key={item.value} value={item.value}>
                    {item.label}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuCheckboxItem
              checked={props.firstParent}
              onCheckedChange={props.onFirstParentChange}
            >
              First parent
            </MenuCheckboxItem>
            <MenuCheckboxItem
              checked={props.allRemoteBranches}
              onCheckedChange={props.onAllRemoteBranchesChange}
            >
              All remote branches
            </MenuCheckboxItem>
            <MenuCheckboxItem
              checked={props.collapseLinear}
              onCheckedChange={props.onCollapseLinearChange}
            >
              Collapse linear branches
            </MenuCheckboxItem>
            {props.onExpandAll ? <MenuItem onClick={props.onExpandAll}>Expand all</MenuItem> : null}
          </MenuPopup>
        </Menu>
      )}
      <span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
        {props.loadedCount} {props.loadedCount === 1 ? "commit" : "commits"} loaded
      </span>
    </div>
  );
}
