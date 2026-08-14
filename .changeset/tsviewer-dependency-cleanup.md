---
"@pennsieve-viz/tsviewer": minor
---

Remove unused runtime dependencies (core-js, ramda, @element-plus/icons-vue) and fix three bugs: the Amplify import now matches the declared @aws-amplify/auth peer and loads dynamically, so the peer is optional in practice; HTTP 401 responses show a session-expired message instead of throwing a ReferenceError; annotation create and update no longer crash when falling back to the active annotation in the store.
