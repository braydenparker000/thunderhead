"""The job's two connections, with the standard library only: the Worker (the ci key) and the music bucket
(a read-only R2 key, S3 signature v4).

Secrets come from the environment and go nowhere else: never into a log line, an error, a file or a URL.
Every failure is raised as Failed(reason) with a reason from a fixed list; the caller prints only that
reason, so no address, key, hash or server message ever reaches the public log.
"""

import datetime
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.request

BUCKET = "jarvis-music"
MAX_AUDIO = 64 * 1024 * 1024


class Failed(Exception):
    """A failure with a reason from a fixed list (download, hash_mismatch, spec_fetch, upload, collect...)."""

    def __init__(self, reason, status=0):
        super().__init__(reason)
        self.reason = reason
        self.status = status


def _env(name):
    v = os.environ.get(name, "")
    if not v:
        raise Failed("not_configured")
    return v


class Worker:
    def __init__(self):
        self.base = _env("TH_API").rstrip("/")
        self.token = _env("TH_CI_TOKEN")

    def _call(self, method, path, body=None, ctype=None, reason="worker", tries=4):
        headers = {"Authorization": f"Bearer {self.token}", "TH-Client": "ci/jobs-audio", "Accept": "application/json"}
        if ctype:
            headers["Content-Type"] = ctype
        for attempt in range(tries):
            if attempt:
                time.sleep(2**attempt)
            req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers)
            try:
                with urllib.request.urlopen(req, timeout=60) as res:
                    raw = res.read()
                    return res.status, (json.loads(raw) if raw else None)
            except urllib.error.HTTPError as e:
                e.close()
                if e.code < 500 and e.code != 429:
                    raise Failed(reason, e.code) from None
            except (urllib.error.URLError, TimeoutError, OSError):
                pass
        raise Failed(reason)

    def spec(self, job_id):
        return self._call("GET", f"/v1/jobs/{job_id}/spec", reason="spec_fetch")[1]

    def put(self, job_id, name, data):
        self._call("PUT", f"/v1/jobs/{job_id}/files/{name}", data, "application/octet-stream", reason="upload")

    def collect(self, job_id):
        return self._call("POST", f"/v1/jobs/{job_id}/collect", b"{}", "application/json", reason="collect")[1]


def _sign(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()


class Bucket:
    """GET only: the key can do nothing else, and this code asks for nothing else."""

    def __init__(self):
        self.host = f"{_env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com"
        self.key_id = _env("R2_JOBS_ACCESS_KEY_ID")
        self.secret = _env("R2_JOBS_SECRET")

    def _headers(self, path):
        now = datetime.datetime.now(datetime.timezone.utc)
        amz, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        scope = f"{day}/auto/s3/aws4_request"
        signed = "host;x-amz-content-sha256;x-amz-date"
        canonical = f"GET\n{path}\n\nhost:{self.host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:{amz}\n\n{signed}\nUNSIGNED-PAYLOAD"
        to_sign = f"AWS4-HMAC-SHA256\n{amz}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
        k = _sign(_sign(_sign(_sign(("AWS4" + self.secret).encode(), day), "auto"), "s3"), "aws4_request")
        sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
        return {
            "Host": self.host,
            "x-amz-date": amz,
            "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
            "Authorization": f"AWS4-HMAC-SHA256 Credential={self.key_id}/{scope}, SignedHeaders={signed}, Signature={sig}",
        }

    def fetch(self, sha256, dest):
        """Downloads native/audio/<sha256>.opus to `dest`, checking its SHA-256 on the way; its byte count."""
        path = f"/{BUCKET}/native/audio/{sha256}.opus"
        for attempt in range(3):
            if attempt:
                time.sleep(2**attempt)
            h, n = hashlib.sha256(), 0
            try:
                req = urllib.request.Request(f"https://{self.host}{path}", headers=self._headers(path))
                with urllib.request.urlopen(req, timeout=60) as res, open(dest, "wb") as out:
                    for block in iter(lambda: res.read(1 << 16), b""):
                        n += len(block)
                        if n > MAX_AUDIO:
                            raise Failed("download")
                        h.update(block)
                        out.write(block)
            except urllib.error.HTTPError as e:
                e.close()
                if e.code < 500:
                    raise Failed("download", e.code) from None
                continue
            except (urllib.error.URLError, TimeoutError, OSError):
                continue
            if h.hexdigest() != sha256:
                raise Failed("hash_mismatch")
            return n
        raise Failed("download")
