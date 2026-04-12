---
name: shared-blocks-lib
description: Reusable block library — import this file to use the blocks below.
version: 0.1
inputs: {}
outputs: {}
---

# Shared Block Library

This file is a block library. It is not meant to be run directly — import it from
another `.md` file to reuse its blocks.

```runeflow
block check_file_exists type=tool {
  tool: file.exists
  with: { path: inputs.path }
  out: { exists: boolean }
}
```
