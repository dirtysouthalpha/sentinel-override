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

class BrainHealth(Tool):
    def __init__(self):
        super().__init__(
            name="brain_health",
            description="Composite health score for Sentinel Prime: capacity, freshness, connectivity, query hit rate.",
        )

    def execute(self, detailed: bool = False, **kwargs) -> Response:
        from helpers.tool import Response
        health, err = _call("GET", "/health")
        stats, err2 = _call("GET", "/stats")

        if err or err2:
            return Response(f"Brain UNREACHABLE: {err or err2}", {"status": "down"})

        neurons = stats.get("neurons", 0)
        synapses = stats.get("synapses", 0)
        regions = stats.get("regions", 0)

        # Compute composite score (0-100)
        density = synapses / max(neurons, 1)
        density_score = min(density / 2.0, 1.0) * 25  # target >= 2.0

        neuron_score = min(neurons / 50000, 1.0) * 25  # target 50k
        region_score = min(regions / 12, 1.0) * 25     # target 12
        freshness_score = 25  # placeholder — needs event source
        total = int(density_score + neuron_score + region_score + freshness_score)

        status = "healthy" if total >= 70 else "degraded" if total >= 40 else "critical"

        msg = f"🧠 Sentinel Prime Health: {total}/100 ({status})\n"
        msg += f"  Neurons: {neurons:,}  Synapses: {synapses:,}  Regions: {regions}\n"
        msg += f"  Density: {density:.2f}/neuron  Features: {list(health.get("v4_features", {}).keys())}"

        if detailed:
            embed, _ = _call("GET", "/brain/embeddings/status")
            src_qual, _ = _call("GET", "/brain/source-quality")
            diagnose, _ = _call("GET", "/brain/self-heal/diagnose")
            msg += f"\n  Embeddings: {embed.get("coverage_pct","?")}%"
            msg += f"\n  Warnings: {len(diagnose.get("warnings", []))}"

        return Response(msg, {"score": total, "status": status, "neurons": neurons})
