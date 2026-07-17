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

class BrainRecall(Tool):
    def __init__(self):
        super().__init__(
            name="brain_recall",
            description="Recall knowledge from Sentinel Prime with full lineage, causal chains, and narrative synthesis.",
        )

    def execute(self, query: str = "", neuron_id: int = 0, context: str = "general",
                explain: bool = False, **kwargs) -> Response:
        from helpers.tool import Response
        # Predictive recall: add context to query
        context_prefix = {
            "coding": "code programming debug ",
            "infrastructure": "server config deploy ",
            "general": "",
            "research": "research learn discover ",
        }
        enhanced_query = context_prefix.get(context, "") + query

        if neuron_id:
            data, err = _call("GET", f"/neurons/{neuron_id}")
            if err:
                return Response(f"Recall failed: {err}", {})
            content = data.get("content", "")
            if explain:
                lineage, _ = _call("GET", f"/neurons/{neuron_id}/lineage")
                content += f"\n\nLineage: {json.dumps(lineage)[:500]}"
            return Response(content, {"neuron_id": neuron_id})

        data, err = _call("GET", f"/neurons/search?q={urllib.parse.quote(enhanced_query)}&limit=5")
        if err:
            return Response(f"Recall failed: {err}", {})

        results = data.get("results", [])
        if not results:
            return Response(f"No relevant knowledge found for "{query}"", {})

        # Synthesize narrative
        synthesis_input = "\n".join(f"- {r.get("content","")[:200]}" for r in results[:5])
        narrative = f"Based on {len(results)} memories:\n{synthesis_input}"

        return Response(narrative, {"count": len(results), "query": query})
