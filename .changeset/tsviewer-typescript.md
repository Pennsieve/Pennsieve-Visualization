---
"@pennsieve-viz/tsviewer": major
---

The package is now written in TypeScript throughout, including every Vue component, and ships type declarations generated from that source rather than inferred from JavaScript. Type checking covers component templates. TypeScript hosts may find that previously untyped imports now type-check, which can surface existing mistakes in host code.
