"""HTTP security tests use an injected toy encoder; no MLX/model download needed."""
import json
import socket
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import Mock
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from embed_server import handler_for


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.pause = False
        self.fail = False
        self.started = threading.Event()
        self.release = threading.Event()

        def encode(texts, kind, dimensions):
            self.calls.append((texts, kind, dimensions))
            if self.pause:
                self.started.set()
                if not self.release.wait(5):
                    raise RuntimeError("Test inference did not resume")
            if self.fail:
                raise RuntimeError("Private input must not appear in errors")
            return [[1.0] + [0.0] * (dimensions - 1) for _ in texts]

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(encode, token="test"))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.release.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, payload=None, auth=True, method="POST", headers=None):
        conn = HTTPConnection("127.0.0.1", self.server.server_port, timeout=2)
        h = {"Authorization": "Bearer test"} if auth else {}
        h.update(headers or {})
        conn.request(method, path, json.dumps(payload) if payload is not None else None, h)
        response = conn.getresponse()
        result = response.status, dict(response.getheaders()), json.loads(response.read())
        conn.close()
        return result

    def test_shapes_and_no_cors(self):
        status, headers, result = self.request("/v1/embeddings", {"input": ["hello", "world"], "input_type": "query", "dimensions": 32})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["data"]), 2)
        self.assertEqual(len(result["data"][0]["embedding"]), 32)
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(self.calls[0][1], "query")
        self.assertEqual(self.request("/embeddings", {"input": "x"})[0], 200)
        self.assertTrue(self.request("/health", method="GET")[2]["ok"])

    def test_idle_browser_socket_does_not_block_requests(self):
        # Chrome may preconnect before it has any HTTP bytes to send.
        with socket.create_connection(self.server.server_address, timeout=2):
            self.assertTrue(self.request("/health", method="GET")[2]["ok"])
            self.assertEqual(self.request("/v1/embeddings", {"input": "test"})[0], 200)

    def test_busy_inference_does_not_block_health_or_queue_more_work(self):
        self.pause = True
        with ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(self.request, "/v1/embeddings", {"input": "first"})
            try:
                self.assertTrue(self.started.wait(2))
                self.assertTrue(self.request("/health", method="GET")[2]["ok"])
                status, _, result = self.request("/v1/embeddings", {"input": "second"})
                self.assertEqual(status, 503)
                self.assertIn("busy", result["error"]["message"])
                self.assertEqual(len(self.calls), 1)
            finally:
                self.release.set()
            self.assertEqual(first.result(timeout=2)[0], 200)
        self.assertEqual(self.request("/v1/embeddings", {"input": "third"})[0], 200)

    def test_inference_failure_releases_lock_without_leaking_input(self):
        self.fail = True
        status, _, result = self.request("/v1/embeddings", {"input": "private"})
        self.assertEqual(status, 500)
        self.assertEqual(result["error"]["message"], "Embedding inference failed")
        self.fail = False
        self.assertEqual(self.request("/v1/embeddings", {"input": "next"})[0], 200)

    def test_client_disconnect_is_not_an_inference_error(self):
        for error in (BrokenPipeError, ConnectionResetError):
            handler = self.server.RequestHandlerClass.__new__(self.server.RequestHandlerClass)
            handler.send_response = Mock()
            handler.send_header = Mock()
            handler.end_headers = Mock()
            handler.wfile = Mock()
            handler.wfile.write.side_effect = error
            handler.close_connection = False
            handler.reply(200, {"ok": True})
            self.assertTrue(handler.close_connection)
            handler.send_response.assert_called_once_with(200)

    def test_auth_and_validation(self):
        self.assertEqual(self.request("/v1/embeddings", {"input": "x"}, auth=False)[0], 401)
        self.assertEqual(self.request("/v1/embeddings")[0], 413)
        for payload in ({"input": []}, {"input": ["x"]*257}, {"input": 1}, {"input": "x", "dimensions": 33}, {"input": "x", "input_type": "bad"}):
            self.assertEqual(self.request("/v1/embeddings", payload)[0], 400)
        self.assertEqual(self.calls, [])


if __name__ == "__main__":
    unittest.main()
