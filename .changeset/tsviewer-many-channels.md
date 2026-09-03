---
"@pennsieve-viz/tsviewer": minor
---

Renders wide, many-channel recordings. A page whose read keeps failing backs off and is recorded as empty instead of being requested without end, and one unreadable channel no longer blanks the channels after it. Filtered and montaged pages are sized to the reader's byte cap, and nothing is requested before the viewport has a measured width. Each row scales by its unit: a channel far outside the shared microvolt scale is fitted to its own row, channels in another unit share a scale of their own, and no trace paints more than two rows past its baseline. The scrubber's availability scan applies in one pass. The dev fixture server serves the bundle named by `TS_ZARR_ROOT`.
