import { Cloud, Tag } from "lucide-react";

import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { gitGraphLaneColor } from "./gitGraphPalette";
import { refBadgeLabel, type GitGraphRefBadge as RefBadgeModel } from "./gitGraph.logic";

/** A ref badge that stays within `max-w-36` and shows its full name in a tooltip. */
export function GitGraphRefBadge(props: { badge: RefBadgeModel; color: number }) {
  const { badge } = props;
  switch (badge.kind) {
    case "head":
      return (
        <Badge variant="default" size="sm">
          HEAD
        </Badge>
      );
    case "worktree":
      return (
        <Badge variant="info" size="sm">
          worktree
        </Badge>
      );
    case "local":
      return (
        <NamedBadge name={badge.name} variant="outline">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: gitGraphLaneColor(props.color) }}
          />
        </NamedBadge>
      );
    case "remote":
      return (
        <NamedBadge name={badge.name} variant="secondary">
          <Cloud aria-hidden />
        </NamedBadge>
      );
    case "tag":
      return (
        <NamedBadge name={badge.name} variant="secondary">
          <Tag aria-hidden />
        </NamedBadge>
      );
  }
}

function NamedBadge(props: {
  name: string;
  variant: "outline" | "secondary";
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex min-w-0 max-w-36" />}>
        <Badge variant={props.variant} size="sm" className="max-w-full">
          {props.children}
          <span className="truncate">{props.name}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipPopup side="top">{props.name}</TooltipPopup>
    </Tooltip>
  );
}

/** The `+N` badge for refs that do not fit; its tooltip lists them. */
export function GitGraphMoreRefsBadge(props: { hidden: ReadonlyArray<RefBadgeModel> }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0" />}>
        <Badge variant="secondary" size="sm">
          +{props.hidden.length}
        </Badge>
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-80">
        {props.hidden.map(refBadgeLabel).join(", ")}
      </TooltipPopup>
    </Tooltip>
  );
}
