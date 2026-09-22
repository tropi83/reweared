---
title: Adopt ccgh
date: 2026-09-22
participants:
  - ccgh
---

# Adopt ccgh

## What prompted this

This repository ran `ccgh init`. From now on its work moves through iterations and fixes
recorded in this content directory, and mirrored to GitHub issues by the workflows `init`
wrote. This iteration is the first of them: it brings those workflows, `ccgh.json` and the
lifecycle rules in `CLAUDE.md` onto `main`, through the same gates as every later change.

## What was considered

Committing the output of `init` straight to `main` was not possible: the hooks refuse a commit
on `main`, and the validation workflow refuses code that belongs to no iteration or fix. A fix
record would have been lighter, and was set aside so that the repository's first change goes
through the whole lifecycle once, gates included.

The checks the commit hook runs are the one setting `init` cannot choose. Which commands suit
this repository, and whether they accept file arguments, is a decision for the people who
maintain it, so it is this iteration's only task.

## Not settled here

Which domains this repository has. They are created as work arrives, one at a time, by the
assistant that classifies it, and seen in the pull request that brings each one.
