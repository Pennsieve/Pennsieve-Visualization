# test-data

Two unrelated Zarr fixtures live here:

- **`sample.zarr`** - a 3-D **imaging** OME-Zarr volume (multiscales v0.4, blosc/lz4,
  regular chunks, no sharding). Served on **:9090** by `scripts/serve-test-zarr.py` for the
  orthogonal/micro-ct viewers.

- **`sample-timeseries.zarr`** - a **timeseries bundle** (Zarr v3, ZEP2 sharding + Zstd,
  consolidated metadata) for the ts-viewer Zarr streaming path. Served on **:9091** by
  `scripts/serve-timeseries-zarr.mjs`, which serves the directory named by `TS_ZARR_ROOT`
  instead when that variable is set, so a larger bundle never has to replace this fixture
  (the unit tests read it). Range-request capable. Sharded bundles require
  ranged GETs, which the Python :9090 server does not support. Contents: `sineA`
  (50 sin 5 Hz), `sineB` (30 sin 8 Hz), `noise` - all 1 kHz × 30,000 samples starting at
  `start_us = 1704067200000000` (2024-01-01T00:00:00Z) with 4 pyramid levels, plus `unitA`
  (200 spike events, 32-point waveforms @ 30 kHz).
