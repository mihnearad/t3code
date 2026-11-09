/** Theme tokens only, so lanes follow light, dark and custom palettes. */
const GIT_GRAPH_LANE_COLORS = [
  "var(--info-foreground)",
  "var(--success-foreground)",
  "var(--warning-foreground)",
  "var(--guest-foreground)",
  "var(--error-foreground)",
  "var(--primary)",
] as const;

export function gitGraphLaneColor(color: number): string {
  return GIT_GRAPH_LANE_COLORS[color % GIT_GRAPH_LANE_COLORS.length]!;
}
