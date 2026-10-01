"""An OpenAI-compatible provider whose behaviour is chosen by the model a connection names.

`GET /v1/models` lists every behaviour, so a connection on any of them validates; `POST
/v1/chat/completions` streams as OpenAI does, and then misbehaves the way its model says:

  silent     two deltas, then holds the connection open and sends nothing more  -> llm/silent
  error-mid  one delta, then an error event mid-stream                          -> llm/failed
  no-credit  402 insufficient_quota before any byte                             -> llm/insufficient-credits
  prose      a whole answer that is not the JSON asked for                      -> llm/unparseable
  bad-sql    a plan whose SQL the engine refuses                                -> query/failed
"""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODELS = ["silent", "error-mid", "no-credit", "prose", "bad-sql"]


def chunk(content=None, finish=None):
    delta = {} if content is None else {"content": content}
    return {"choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}


class Provider(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)

    def answer(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_event(self, payload):
        text = payload if isinstance(payload, str) else json.dumps(payload)
        self.wfile.write(f"data: {text}\n\n".encode())
        self.wfile.flush()

    def do_GET(self):
        if self.path.startswith("/v1/models"):
            return self.answer(200, {"data": [{"id": m, "object": "model"} for m in MODELS]})
        self.answer(404, {"error": {"message": "no such route"}})

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        request = json.loads(self.rfile.read(length) or b"{}")
        model = request.get("model")
        if model == "no-credit":
            return self.answer(
                402,
                {"error": {"message": "You exceeded your current quota", "code": "insufficient_quota"}},
            )
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        if model == "silent":
            self.send_event(chunk("{\"sql\": "))
            self.send_event(chunk("\"SELECT"))
            threading.Event().wait()  # never another byte
        elif model == "error-mid":
            self.send_event(chunk("{\"sql\""))
            self.send_event({"error": {"message": "The server is overloaded", "type": "server_error"}})
        elif model == "prose":
            self.send_event(chunk("You should look at the people table."))
            self.send_event(chunk(finish="stop"))
            self.send_event("[DONE]")
        elif model == "bad-sql":
            plan = {"sql": "SELEC 1", "explanation": "One row.", "reasoning": "r"}
            self.send_event(chunk(json.dumps(plan)))
            self.send_event(chunk(finish="stop"))
            self.send_event("[DONE]")
        else:
            self.send_event({"error": {"message": f"unknown model {model}", "type": "invalid_request"}})


print("fake-llm on :8000", flush=True)
ThreadingHTTPServer(("0.0.0.0", 8000), Provider).serve_forever()
