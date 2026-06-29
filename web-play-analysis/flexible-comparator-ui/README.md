# Flexible Comparator UI

Static Version 6 frontend for the mixed timing comparator demo.

It serves the verified frame sequence from:

```text
web-play-analysis/flexible-comparator-ui/demo/mixed/
```

Run it from the repository root or this directory:

```bash
node web-play-analysis/flexible-comparator-ui/server.mjs
```

Open:

```text
http://127.0.0.1:8782/
```

This version does not call `/api/compare`. The page uses the verified Version 6
region data and performs the offset search in the browser over the PNG frame
sequence.
