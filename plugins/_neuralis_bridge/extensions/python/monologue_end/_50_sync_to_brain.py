"""Neuralis Brain Bridge v2 — Auto-sync + Read-back + PII redaction.

Fires at monologue_end (write) and message_start (read-back).
"""
from __future__ import annotations
import json, os, re, urllib.error, urllib.request
from typing import Any

from agent import LoopData
from helpers.extension import Extension
from helpers.defer import DeferredTask, THREAD_BACKGROUND
from helpers.print_style import PrintStyle

DEFAULT_CONFIG = {
    "brain_url": "http://100.70.240.55:8001",
    "auto_sync_enabled": True,
    "min_turns": 2,
    "default_region": "knowledge",
    "source": "agent-zero",
    "timeout": 15,
    "readback_enabled": True,
    "readback_top_k": 3,
    "readback_min_score": 0.65,
    "pii_redaction": True,
    "dedup_check": True,
    "batch_sync": True,
}

# --- PII patterns to strip before storing ---
PII_PATTERNS = [
    (re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"), "[REDACTED_EMAIL]"),
    (re.compile(r"\b(?:sk-|ghp_|gho_)[A-Za-z0-9]{20,}\b"), "[REDACTED_TOKEN]"),
    (re.compile(r"\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b"), "[REDACTED_IP]"),
    (re.compile(r"(?i)(?:password|secret|key)\s*[:=]\s*\S+", re.IGNORECASE), "[REDACTED_SECRET]"),
]

# --- Region routing: keyword → brain region ---
REGION_ROUTING = [
    (re.compile(r"(?i)(?:server|host|port|deploy|config|env|process|service)"), "infrastructure"),
    (re.compile(r"(?i)(?:decided|chose|prefer|wanted|like|dislike|love|hate)"), "amygdala"),
    (re.compile(r"(?i)(?:remember|learned|study|research|history|past)"), "hippocampus"),
    (re.compile(r"(?i)(?:plan|strategy|goal|future|will|going to|roadmap)"), "prefrontal_left"),
    (re.compile(r"(?i)(?:idea|creative|design|art|music)"), "prefrontal_right"),
    (re.compile(r"(?i)(?:language|read|write|speak|translate)"), "temporal_left"),
    (re.compile(r"(?i)(?:spatial|visual|image|screen|map|navigate)"), "parietal_right"),
    (re.compile(r"(?i)(?:motor|click|move|type|automate|macro)"), "basal_left"),
    (re.compile(r"(?i)(?:health|monitor|cpu|memory|disk|performance)"), "basal_right"),
    (re.compile(r"(?i)(?:think|reason|analyze|logic|calculate)"), "thalamus"),
]

EXTRACT_SYS_PROMPT = """You are a knowledge extraction system. Extract key facts, decisions, solutions, and important information from the conversation below.

Rules:
- Extract only actionable, durable facts worth remembering long-term
- Include: configurations, credentials (without values), file paths, server details, decisions, solutions, preferences
- Exclude: pleasantries, intermediate reasoning, failed attempts, temporary status
- Format as a JSON array of strings, each string is one concise fact
- Each fact should be self-contained and understandable without context
- Do NOT include email addresses, API keys, passwords, or tokens
- If nothing worth remembering, return an empty array []

Example output:
["Server X runs on port 8080 with config at /etc/x.conf", "User prefers dark mode for all interfaces"]
"""


class NeuralisBridge(Extension):
    """Sync conversation knowledge to Neuralis Brain at monologue_end."""

    def execute(self, loop_data: LoopData = LoopData(), **kwargs):
        if not self.agent:
            return

        config = self._get_config()
        if not config.get("auto_sync_enabled", True):
            return

        task = DeferredTask(thread_name=THREAD_BACKGROUND)
        task.start_task(self._sync_conversation, config)

    async def _sync_conversation(self, config: dict):
        """Extract key facts, deduplicate, and store in brain."""
        try:
            history_output = self.agent.history.output()
            texts = []
            for item in history_output:
                role = item.get("role", "")
                content = item.get("content", "")
                if isinstance(content, list):
                    content = " ".join(str(c) for c in content)
                texts.append(f"{role}: {content}")
            conversation = "\n---\n".join(texts)

            if not conversation.strip():
                return

            user_turns = conversation.count("user:")
            min_turns = config.get("min_turns", 2)
            if user_turns < min_turns:
                return

            # Extract facts
            facts = await self._extract_facts(conversation, config)
            if not facts:
                return

            # Process each fact
            brain_url = config.get("brain_url", DEFAULT_CONFIG["brain_url"])
            source = config.get("source", "agent-zero")
            timeout = config.get("timeout", 15)
            pii_redaction = config.get("pii_redaction", True)
            dedup_check = config.get("dedup_check", True)
            batch_sync = config.get("batch_sync", True)

            processed_facts = []
            skipped_pii = 0
            skipped_dup = 0

            for fact in facts:
                if not isinstance(fact, str) or not fact.strip():
                    continue
                fact = fact.strip()

                # PII redaction
                if pii_redaction:
                    original = fact
                    for pattern, replacement in PII_PATTERNS:
                        fact = pattern.sub(replacement, fact)
                    if fact != original:
                        skipped_pii += 1

                # Deduplication: compute fingerprint and check brain
                if dedup_check:
                    fingerprint = self._compute_fingerprint(fact)
                    if await self._fingerprint_exists(brain_url, fingerprint, timeout):
                        skipped_dup += 1
                        continue

                processed_facts.append(fact)

            if not processed_facts:
                PrintStyle().debug("Neuralis Bridge v2: All facts filtered (PII or dup)")
                return

            # Store facts (batch or individual)
            stored = 0
            if batch_sync:
                stored = await self._batch_post(brain_url, processed_facts, source, timeout)
            else:
                for fact in processed_facts:
                    if self._post_to_brain(brain_url, fact, source, timeout):
                        stored += 1

            PrintStyle().debug(
                f"Neuralis Bridge v2: Synced {stored}/{len(processed_facts)} facts "
                f"(skipped PII={skipped_pii}, dup={skipped_dup})"
            )

        except Exception as e:
            PrintStyle().debug(f"Neuralis Bridge v2 sync failed: {e}")

    async def _extract_facts(self, conversation: str, config: dict) -> list:
        """Use the utility model to extract key facts."""
        try:
            utility = self.agent.get_utility_model()
            if len(conversation) > 40000:
                conversation = conversation[-40000:]

            response, _ = await utility.unified_call(
                system_message=EXTRACT_SYS_PROMPT,
                user_message=f"Extract key facts from this conversation:\n\n{conversation}",
            )

            response = response.strip()
            start = response.find("[")
            end = response.rfind("]")
            if start >= 0 and end > start:
                json_str = response[start : end + 1]
                facts = json.loads(json_str)
                if isinstance(facts, list):
                    return facts

            return []
        except Exception as e:
            PrintStyle().debug(f"Neuralis Bridge v2: Fact extraction failed: {e}")
            return []

    def _route_region(self, content: str) -> str:
        """Determine the best brain region for a fact based on content."""
        for pattern, region in REGION_ROUTING:
            if pattern.search(content):
                return region
        return DEFAULT_CONFIG["default_region"]

    def _compute_fingerprint(self, content: str) -> str:
        """Compute a simple dedup fingerprint."""
        normalized = re.sub(r"\s+", " ", content.lower().strip())
        return str(hash(normalized) % (2**32))

    async def _fingerprint_exists(self, brain_url: str, fingerprint: str, timeout: int) -> bool:
        """Check if a neuron with similar content already exists."""
        try:
            # Search for the first 50 chars to detect near-duplicates
            search_term = fingerprint[:50] if len(fingerprint) > 50 else fingerprint
            url = f"{brain_url}/neurons/search?q={urllib.parse.quote(search_term)}&limit=5"
            req = urllib.request.Request(url=url, method="GET")
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                return data.get("count", 0) > 0
        except Exception:
            return False

    def _post_to_brain(
        self, brain_url: str, content: str, source: str, timeout: int
    ) -> bool:
        """POST a single fact to the Neuralis Brain with region routing."""
        try:
            region = self._route_region(content)
            payload = json.dumps(
                {
                    "topic": content[:100],
                    "content": f"[{source}] {content}",
                    "region": region,
                    "source": source,
                }
            ).encode("utf-8")

            req = urllib.request.Request(
                url=f"{brain_url}/neurons/think",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )

            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                neuron = data.get("neuron", {})
                return neuron.get("id") is not None

        except Exception as e:
            PrintStyle().debug(f"Neuralis Bridge v2: Brain POST failed: {e}")
            return False

    async def _batch_post(self, brain_url: str, facts: list, source: str, timeout: int) -> int:
        """Try batch/individual POST — fallback gracefully."""
        stored = 0
        for fact in facts:
            if self._post_to_brain(brain_url, fact, source, timeout):
                stored += 1
        return stored

    def _get_config(self) -> dict:
        """Load config from default_config.yaml."""
        try:
            import yaml
            plugin_dir = os.path.dirname(
                os.path.dirname(
                    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                )
            )
            config_path = os.path.join(plugin_dir, "default_config.yaml")
            if os.path.exists(config_path):
                with open(config_path, "r") as f:
                    loaded = yaml.safe_load(f) or {}
                return {**DEFAULT_CONFIG, **loaded}
        except Exception:
            pass
        return DEFAULT_CONFIG.copy()
