---
"@pennsieve-viz/tsviewer": minor
---

Reads TS-Zarr 1.0 bundles through `@pennsieve/timeseries-zarr-reader` 1.0.0-beta.0. Bundle times are shifted onto the viewer's epoch clock from the recording's reference time, so a recording shows its real dates. A bundle's event channels appear in the viewer: one that stores waveforms is drawn as a spike row, and every other one becomes a read-only annotation layer prefixed `bundle:`, read a window at a time beside the API's layers. The test suite fetches the reader's own fixture bundle from its repository at the installed version instead of carrying a copy.
