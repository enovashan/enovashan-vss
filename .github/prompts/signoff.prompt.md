---
description: "Signoff: safely commit and push project changes before switching devices."
agent: agent
---

Prepare this repository for continuing on another device:

1. Inspect the current branch, remotes, upstream, status, and complete diff,
   including staged changes and relevant untracked files. Stop for a detached
   HEAD or unfinished merge/rebase. Do not switch branches automatically.
2. Review the intended changes for secrets and accidental files before staging.
   Never commit credentials, secret environment files, downloaded videos,
   local helper state, dependency directories, or unrelated personal files.
   If scope or sensitive content is uncertain, ask before proceeding.
3. Run the smallest relevant existing validation for code changes. Documentation
   or prompt-only changes need no build. If validation fails, report it and ask
   before committing a failing handoff; never describe untested work as verified.
4. Fetch the relevant remote before committing. If upstream has incoming commits
   or has diverged, stop and ask how to integrate them while preserving local
   work; do not auto-stash, merge, rebase, reset, or force-push.
5. Stage only reviewed project changes and create a descriptive commit. Include
   a short handoff in the commit body: completed work, validation, and known
   remaining tasks. Do not create a separate handoff file. Include this trailer:

   Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>

6. Push the current branch to its configured upstream. If none exists, confirm
   the intended remote and branch with the user first. Never force-push, amend,
   or merge into main as part of this command. If there is nothing to commit,
   still check for existing unpushed commits and push them.
7. Verify the push succeeded by fetching and comparing HEAD with upstream, and
   check the final working-tree status. If push fails, clearly state that the
   commit is local only and the other device cannot pull it yet.
8. Report the branch, commit, push result, any remaining local changes, and a
   concise next-device handoff. Remind the user to open the same branch on the
   other device and run Signin.

For this repository, pushing main triggers the production Vercel deployment.
Mention that consequence when signing off on main; do not change branches or
claim deployment success without checking deployment status.
This command does not transfer chat history, credentials, or local helper state.
