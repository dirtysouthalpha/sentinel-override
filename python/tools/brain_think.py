"""Sentinel Prime Brain Tools — v2.0

Features: emotional valence, thought chains, batch ops, PII redaction,
          lineage tracking, predictive recall, composite health scoring.
"""
import os, json, re, hashlib, time, urllib.error, urllib.request
from datetime import datetime, timezone
from typing import Any

BRAIN_URL = os.environ.get("BRAIN_URL", "http://100.70.240.55:8001")
BRAIN_TIMEOUT = int(os.environ.get("BRAIN_TIMEOUT", "30"))

# PII patterns
_PII = [
    (re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"), "[EMAIL]"),
    (re.compile(r"\b(?:sk-|ghp_|gho_)[A-Za-z0-9]{20,}\b"), "[TOKEN]"),
    (re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b"), "[IP]"),
]

def _redact_pii(text: str) -> str:
    for pat, repl in _PII:
        text = pat.sub(repl, text)
    return text

def _call(method, path, data=None, timeout=BRAIN_TIMEOUT):
    url = f"{BRAIN_URL}{path}"
    body = None
    if data is not None:
        body = json.dumps(data, separators=(',', ':')).encode()
    req = urllib.request.Request(url, data=body, method=method)
    if body:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode()), None
    except Exception as e:
        return None, str(e)

def _fingerprint(text):
    normalized = re.sub(r"\s+", " ", text.lower().strip())[:200]
    return hashlib.md5(normalized.encode()).hexdigest()

from helpers.tool import Tool, Response

class BrainThink(Tool):
    def __init__(self):
        super().__init__(
            name="brain_think",
            description="Store a thought in Sentinel Prime with emotional valence, dedup, and region routing.",
        )

    def execute(self, content: str, emotion: str = "neutral", valence: float = 0.0,
                arousal: float = 0.0, region: str = "", source: str = "agent-zero",
                **kwargs) -> Response:
        from helpers.tool import Response
        content = _redact_pii(content)
        if not content.strip():
            return Response("Empty content", {})

        # Auto-route region based on keywords
        if not region:
            region = self._route_region(content)

        fp = _fingerprint(content)

        payload = {
            "topic": content[:100],
            "content": f"[{source}] {content}",
            "region": region,
            "source": source,
            "emotional_valence": valence,
            "emotional_arousal": arousal,
            "content_fingerprint": fp,
        }

        data, err = _call("POST", "/neurons/think", payload)
        if err:
            return Response(f"Brain store failed: {err}", {})

        neuron = data.get("neuron", {})
        return Response(f"Stored neuron {neuron.get("id")} in {region} (valence={valence})", {"neuron_id": neuron.get("id"), "region": region})

    @staticmethod
    def _route_region(content: str) -> str:
        c = content.lower()
        if any(w in c for w in ["server","host","port","deploy","config","service","infra"]):
            return "infrastructure"
        if any(w in c for w in ["decided","prefer","like","want","love","hate"]):
            return "amygdala"
        if any(w in c for w in ["remember","learned","study","history","past"]):
            return "hippocampus"
        if any(w in c for w in ["plan","strategy","goal","future","roadmap"]):
            return "prefrontal_left"
        if any(w in c for w in ["code","program","debug","algorithm","api"]):
            return "technology"
        return "knowledge"
