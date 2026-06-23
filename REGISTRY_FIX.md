# npm Registry Fix

FNEBooks pins exact dependency versions and resolves everything against the public npm registry in `package-lock.json` (no private build-environment URLs).

Install with:

```bash
rm -rf node_modules
npm cache clean --force
npm ci --no-audit --no-fund
```
