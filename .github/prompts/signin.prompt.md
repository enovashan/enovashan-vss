---
description: "Signin: safely pull the current project branch when resuming on another device."
agent: agent
---

Resume work in this repository on the current device:

1. Check the repository, current branch, working tree, upstream, and remotes.
   Report the branch being resumed. Do not switch branches automatically.
2. If there are staged, unstaged, or untracked changes, stop and ask the user
   how to handle them. Never discard, stash, or commit them automatically.
   Stop for a detached HEAD or unfinished merge/rebase as well.
3. Fetch the relevant remote. If no upstream exists, ask which remote branch
   to use rather than guessing. Pull the current branch using fast-forward-only
   behavior. If histories have diverged, stop and explain; do not merge,
   rebase, reset, or force-push automatically.
4. Check status and upstream comparison after pulling. Explicitly report local
   commits that are still ahead; do not claim the devices match in that case.
5. Read the latest commit messages, including any handoff, and summarize what
   changed and the next steps. Check whether incoming dependency-manifest or
   lockfile changes require the project's normal dependency setup. Never copy
   secrets from another device or invent missing credentials.
6. Report the branch, resulting commit, working-tree status, and any setup still
   required. Surface command failures; do not claim success if the pull failed.

This command pulls code, not conversation history or local video-helper state.
