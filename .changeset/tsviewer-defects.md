---
"@pennsieve-viz/tsviewer": major
---

Fixes defects found while restructuring. Annotation paging landed on the wrong annotation for any cursor time that was not exactly an annotation start, and now does nothing at the ends of a layer instead of selecting the nearest one. Paging on an empty layer threw. A filter missing a required frequency built a message the reader discarded silently; it is now refused before sending. Switching montage before a package was activated threw. A timeseries with no annotation layers never got its default layer created. Failed annotation requests reached no one, and a failed layer fetch marked its range as loaded so it was never retried. Editing an annotation into another layer dropped the change. Annotation previews and pointer selection treated a channel that had not been laid out as the top row of the canvas, and the selection box leaked its stroke style onto other overlays.
