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

class BrainSearch(Tool):
    def __init__(self):
        super().__init__(
            name="brain_search",
            description="Search Sentinel Prime neurons with thought chains, region filters, and predictive ranking.",
        )

    def execute(self, query: str, limit: int = 10, region: str = "",
                min_confidence: float = 0.0, chain: bool = False, **kwargs) -> Response:
        from helpers.tool import Response
        params = f"q={urllib.parse.quote(query)}&limit={limit}"
        if region:
            params += f"&region={region}"

        data, err = _call("GET", f"/neurons/search?{params}")
        if err:
            return Response(f"Search failed: {err}", {})

        results = data.get("results", [])
        if min_confidence > 0:
            results = [r for r in results if r.get("confidence", 0.5) >= min_confidence]

        # Predictive ranking: boost recently-fired and high-valence
        def score(n):
            base = n.get("confidence", 0.5)
            fire_boost = min(n.get("fire_count", 0) * 0.01, 0.3)
            val_boost = abs(n.get("emotional_valence", 0)) * 0.2
            return base + fire_boost + val_boost

        results.sort(key=score, reverse=True)

        thought_chain = None
        if chain and results:
            chain_data, _ = _call("POST", "/brain/synthesize/chain",
                                  {"query": query, "seed_neuron_ids": [r["id"] for r in results[:3]], "depth": 3})
            thought_chain = chain_data

        lines = [f""{query}" — {len(results)} results:"]
        for r in results[:5]:
            lines.append(f"  [{r.get("region","?")}] ({r.get("fire_count",0)} fires) {r.get("content","")[:120]}")

        msg = "\n".join(lines)
        return Response(msg, {"count": len(results), "thought_chain": thought_chain})
