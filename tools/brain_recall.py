"""Brain recall tool — direct A0 -> Neuralis brain recall path."""
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


class BrainRecallTool(Tool):
    """Recall knowledge from the Neuralis brain."""

    async def execute(self, **kwargs):
        import httpx
        cfg = _load_neuralis()
        base = cfg.get("brain_url", _DEFAULT_URL)
        timeout = cfg.get("timeout_seconds", 10)
        query = self.args.get("query") or kwargs.get("query") or ""
        context = self.args.get("context") or kwargs.get("context") or query
        k = int(self.args.get("k", kwargs.get("k", 5)))
        if not context:
            return Response(message="query or context is required", break_loop=False)
        try:
            r = httpx.get(
                f"{base}/recall",
                params={"context": context, "k": k},
                timeout=timeout,
            )
            r.raise_for_status()
            data = r.json()
            results = data.get("results") or data.get("direct") or []
            return Response(message=json.dumps({"results": results, "count": len(results)}), break_loop=False)
        except Exception as e:
            return Response(message=json.dumps({"error": f"brain unreachable: {e}", "results": []}), break_loop=False)
