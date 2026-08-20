---
"@pennsieve-viz/tsviewer": minor
---

Remove unused runtime dependencies (core-js, ramda, @element-plus/icons-vue) and fix two bugs: HTTP 401 responses show a session-expired message instead of throwing a ReferenceError, and annotation create and update no longer crash when falling back to the active annotation in the store.
