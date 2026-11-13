# Features of the `rad` fork

This folder applies to the `rad` branch of the RAD Digital Solutions fork only.
It records the features we build ourselves, so that an upstream merge does not
remove them by accident and so that we know what to offer upstream.

- This page is the feature log.
- [`plans/`](./plans/) holds one plan per feature. A plan stays after the
  feature ships, with its status set to "Shipped", so we keep the reasons for
  our decisions.
- Deploy steps are in
  [docs/operations/rad-fork-deploy.md](../operations/rad-fork-deploy.md).

Unlike upstream, the fork commits its plans, but only in this folder.

## Feature log

Add a row when you start a plan, and update it when the feature lands on `rad`.

| Date       | Feature                                 | Status  | Plan                                 | Commits                    | Upstream? |
| ---------- | --------------------------------------- | ------- | ------------------------------------ | -------------------------- | --------- |
| 07/11/2026 | Files sidebar: create files and folders | Shipped | -                                    | `7c747e3fd1`, `306822fe8d` | Not sent  |
| 07/11/2026 | Files sidebar: rename files and folders | Shipped | -                                    | `04995d1761`               | Not sent  |
| 07/11/2026 | Files sidebar: move by drag             | Shipped | -                                    | `ed592d17c4`               | Not sent  |
| 07/11/2026 | Files sidebar: upload by drop           | Shipped | -                                    | `8eb0aa0187`, `fd44bf9887` | Not sent  |
| 07/11/2026 | Files sidebar: delete files and folders | Shipped | -                                    | `e53753a8e3`, `9cfbe90a6d` | Not sent  |
| 07/11/2026 | Private update feed and deploy steps    | Shipped | -                                    | `4b14a8e161`               | Fork only |
| 09/11/2026 | Git graph surface                       | Shipped | [git-graph.md](./plans/git-graph.md) | `feature/git-graph` merge  | Not sent  |
| 09/11/2026 | Files sidebar: performance fixes        | Shipped | -                                    | `5e7658e4a7`               | Not sent  |
| 12/11/2026 | Git graph: steady commit details card   | Shipped | [git-graph.md](./plans/git-graph.md) | `79cd702566`               | Not sent  |
| 13/11/2026 | Nightly merge script                    | Shipped | -                                    | this commit                | Fork only |
