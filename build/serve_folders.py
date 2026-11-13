"""Serve only the Folders release on a stable local address."""
import argparse
import os
import socket
import subprocess
import webbrowser
from urllib.request import ProxyHandler, build_opener
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARTIFACT = HERE / "Reclassifier_Folders.html"
if not ARTIFACT.is_file():
    ARTIFACT = HERE.parent / "dist" / ARTIFACT.name
HOST = "127.0.0.1"
PORT = 8765
URL = f"http://{HOST}:{PORT}/"
APP_HEADER = "X-Reclassifier-Folders"


class FoldersServer(ThreadingHTTPServer):
    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.allow_reuse_address = False
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


class FoldersHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path not in ("/", "/Reclassifier_Folders.html"):
            self.send_error(404)
            return
        body = ARTIFACT.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header(APP_HEADER, "1")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


def open_browser():
    for browser in ("Google/Chrome/Application/chrome.exe", "Microsoft/Edge/Application/msedge.exe"):
        for key in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"):
            directory = os.environ.get(key)
            if directory and (executable := Path(directory) / browser).is_file():
                try:
                    subprocess.Popen([str(executable), URL])
                    return
                except OSError:
                    continue
    webbrowser.open(URL)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--open", action="store_true", help="Открыть приложение в браузере.")
    args = parser.parse_args()
    if not ARTIFACT.is_file():
        raise SystemExit("Файл Reclassifier_Folders.html отсутствует. Пересоберите приложение.")

    try:
        server = FoldersServer((HOST, PORT), FoldersHandler)
    except OSError as error:
        if getattr(error, "winerror", None) not in (10013, 10048) and error.errno not in (48, 98):
            raise
        try:
            with build_opener(ProxyHandler({})).open(URL, timeout=2) as response:
                already_running = response.headers.get(APP_HEADER) == "1"
        except OSError:
            already_running = False
        if not already_running:
            raise SystemExit(f"Порт {PORT} занят другой программой.") from error
        print(f"Приложение уже запущено: {URL}", flush=True)
        if args.open:
            open_browser()
        return

    with server:
        print(f"Приложение запущено: {URL} — оставьте это окно открытым.", flush=True)
        if args.open:
            open_browser()
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
