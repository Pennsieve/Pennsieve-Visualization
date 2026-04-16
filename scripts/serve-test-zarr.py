"""
Serve test-data/sample.zarr over HTTP with CORS on port 9090.
Used during development so the neuroglancer embed can load local zarr data.
"""
import os
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

PORT = 9090
DIR = os.path.join(os.path.dirname(__file__), '..', 'test-data', 'sample.zarr')


class CORSHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, format, *args):
        pass  # suppress request logs


if not os.path.isdir(DIR):
    print(f'⚠  test-data/sample.zarr not found — skipping zarr server on port {PORT}')
    print(f'   Place an OME-Zarr store at test-data/sample.zarr to enable it.')
    sys.exit(0)

print(f'Serving test-data/sample.zarr on http://localhost:{PORT}')
HTTPServer(('', PORT), CORSHandler).serve_forever()
