---
name: ship-to-prod
description: End-to-end deploy of a feature branch to production on Hetzner.
whenToUse: After committing changes when ready to release.
triggers: deploy ship hetzner
---

# Ship-to-prod body

Compose commit + push + merge to develop + merge to main + SSH-deploy.
