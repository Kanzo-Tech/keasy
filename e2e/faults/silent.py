"""A store that accepts every connection and never answers a byte.

The kernel completes the handshake, so a client's connect succeeds and only its request deadline
ends the wait. Stands in for the S3 store/STS/Azure in the `faults` compose profile (scenario 3).
"""

import socket
import sys

port = int(sys.argv[1]) if len(sys.argv) > 1 else 9000
server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
server.bind(("0.0.0.0", port))
server.listen(128)
held = []
print(f"silent on :{port}", flush=True)
while True:
    conn, _ = server.accept()
    held.append(conn)  # kept open, never read from or written to
