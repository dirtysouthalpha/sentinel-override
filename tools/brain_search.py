"""Brain neuron search tool — direct A0 -> Neuralis brain search path."""
import os
import json
from helpers.tool import Tool, Response

_DEFAULT_URL = "http://100.70.240.55:8001"


def _load_neuralis():
    try:
        with open(os.path.join(os.sep, "a0", "usr", "settings.json")) as f:
            s = json.load(f)
        return s.get("neuralis", {})
    except Exception:
        return {}


class BrainSearchTool(Tool):
    """Search neurons in the Neuralis brain by text query."""

    async def execute(self, **kwargs):
        import httpx
        cfg = _load_neuralis()
        base = cfg.get("brain_url", _DEFAULT_URL)
        timeout = cfg.get("timeout_seconds", 10)
        q = self.args.get("q") or kwargs.get("q") or ""
        limit = int(self.args.get("limit", kwargs.get("limit", 10)))
        if not q:
            return Response(message="q is required", break_loop=False)
        try:
            r = httpx.get(
                f"{base}/neurons/search",
                params={"q": q, "limit": limit},
                timeout=timeout,
            )
            r.raise_for_status()
            data = r.json()
            results = data.get("results", []) if isinstance(data, dict) else data
            return Response(message=json.dumps({"results": results, "count": len(results)}), break_loop=False)
        except Exception as e:
            return Response(message=json.dumps({"error": f"brain unreachable: {e}", "results": []}), break_loop=False)
