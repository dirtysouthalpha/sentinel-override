"""Brain outcome tool — record a fleet outcome for the brain's v6 learning-from-outcomes."""
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


class BrainOutcomeTool(Tool):
    """Record a prediction/result outcome so the Neuralis brain can learn from it."""

    async def execute(self, **kwargs):
        import httpx
        cfg = _load_neuralis()
        base = cfg.get("brain_url", _DEFAULT_URL)
        timeout = cfg.get("timeout_seconds", 10)
        prediction = self.args.get("prediction") or kwargs.get("prediction") or ""
        result = self.args.get("result") or kwargs.get("result") or ""
        source = self.args.get("source") or kwargs.get("source") or "agent-zero"
        if not prediction or not result:
            return Response(message="prediction and result are required", break_loop=False)
        try:
            r = httpx.post(
                f"{base}/brain/outcomes",
                json={"prediction": prediction, "result": result, "source": source},
                timeout=timeout,
            )
            r.raise_for_status()
            return Response(message=json.dumps(r.json()), break_loop=False)
        except Exception as e:
            return Response(message=json.dumps({"error": f"brain unreachable: {e}"}), break_loop=False)
