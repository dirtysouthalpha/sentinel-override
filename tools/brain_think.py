"""Brain think tool — store a thought/knowledge in the Neuralis brain."""
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


class BrainThinkTool(Tool):
    """Store a thought/knowledge in the Neuralis brain."""

    async def execute(self, **kwargs):
        import httpx
        cfg = _load_neuralis()
        base = cfg.get("brain_url", _DEFAULT_URL)
        timeout = cfg.get("timeout_seconds", 10)
        topic = self.args.get("topic") or kwargs.get("topic") or ""
        content = self.args.get("content") or kwargs.get("content") or ""
        region = self.args.get("region") or kwargs.get("region") or "technology"
        source = self.args.get("source") or kwargs.get("source") or "agent-zero"
        if not topic or not content:
            return Response(message="topic and content are required", break_loop=False)
        try:
            r = httpx.post(
                f"{base}/neurons/think",
                json={"topic": topic, "content": content, "region": region, "source": source},
                timeout=timeout,
            )
            r.raise_for_status()
            return Response(message=json.dumps(r.json()), break_loop=False)
        except Exception as e:
            return Response(message=json.dumps({"error": f"brain unreachable: {e}"}), break_loop=False)
