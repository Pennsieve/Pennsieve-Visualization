---
"@pennsieve-viz/tsviewer": major
---

The viewer reads data through one typed transport interface. The Zarr path no longer impersonates a WebSocket, so requests go straight to the reader instead of being serialized to JSON and parsed back. Both backends are validated by the same conformance suite, and no component branches on the viewer asset's type any more. Behavior is unchanged: the wire messages the streaming service receives are byte-identical.
