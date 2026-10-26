---
"@bounty-ai/flue": patch
---

Use the application's Hono. `hono` is now a peer dependency, so
`channel.route()` mounts on any Hono 4 app without installing a second copy
or failing to typecheck.
