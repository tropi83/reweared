---
title: Adopt ccgh
status: draft
depends_on: []
impacts: []
---

# Adopt ccgh

## Problem

The repository has run `ccgh init`, and nothing it wrote is on `main` yet: the workflows that
mirror work to GitHub issues, `ccgh.json`, and the lifecycle rules in `CLAUDE.md`. Until they
are, no iteration can be launched and no fix can open its issue.

## Goals

- The five workflows, `ccgh.json` and the `CLAUDE.md` block are on `main`.
- `check` in `ccgh.json` names the commands this repository wants run on the files a commit
  stages, or is deliberately left empty.
- The repository has been through one full cycle: validated, launched, its task merged, shipped.

## Non-goals

- Describing the repository's domains. Each is created by the work that first needs it.
- Changing the repository's own CI. The workflows `init` wrote sit beside it.

## Contract

The adoption commit on this branch carries everything `init` wrote. The one task, configuring
the checks, changes `ccgh.json` and regenerates `.github/workflows/ccgh-validate.yml` with
`ccgh init`, which in a repository that has a content directory only rewrites what it owns.

## Failure modes

- A check command that refuses file arguments fails every commit once it is listed; the task
  says how to try each one before listing it.
- A workflow asks for approval before its first run on a bot's commit; approving it is part of
  the launch.

## Risks

- Two human gates stand before the first merge. That is the lifecycle, shown once.

## Open questions

None blocking.
