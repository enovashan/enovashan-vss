# Device handoff commands

When the user sends `Signin` (case-insensitive) as a standalone command, follow
[the Signin workflow](prompts/signin.prompt.md) to safely pull this project's
current branch.

When the user sends `Signoff` (case-insensitive) as a standalone command, follow
[the Signoff workflow](prompts/signoff.prompt.md) to commit and push this
project's changes.

These workflows also have explicit `/signin` and `/signoff` prompt commands.
Use commands appropriate to the current operating system; do not assume Windows
paths on macOS. Neither workflow synchronizes chat history, credentials, or local
helper state.
