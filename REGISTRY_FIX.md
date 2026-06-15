# npm Registry Fix

Version 1.2.1 replaces private build-environment package URLs in `package-lock.json` with the public npm registry.

Install with:

```bash
rm -rf node_modules
npm cache clean --force
npm ci --no-audit --no-fund
```
