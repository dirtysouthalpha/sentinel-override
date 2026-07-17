"""
Neuralis Brain Client for Agent Zero
Provides fallback LLM functionality when primary providers fail.
"""

import os
import json
import requests
from typing import Optional
from helpers.print_style import PrintStyle


class BrainClient:
    """Client for Neuralis Brain API fallback."""

    def __init__(self):
        # Try to get brain URL from environment or use default
        self.base_url = os.getenv("NEURALIS_BRAIN_URL", "http://100.70.240.55:8001")
        self.timeout = int(os.getenv("NEURALIS_BRAIN_TIMEOUT", "30"))
        self.enabled = os.getenv("NEURALIS_BRAIN_ENABLED", "true").lower() == "true"

        # Check if brain is available
        self._available = None  # Cache availability check
        self._last_check = None

    def is_available(self) -> bool:
        """Check if Neuralis Brain is available with caching."""
        import time

        # Cache for 60 seconds
        if self._available is not None and (time.time() - self._last_check) < 60:
            return self._available

        if not self.enabled:
            self._available = False
            return False

        try:
            response = requests.get(
                f"{self.base_url}/health",
                timeout=5
            )
            self._available = response.status_code == 200
            self._last_check = time.time()

            if self._available:
                PrintStyle().success("Neuralis Brain is available")
            else:
                PrintStyle().warning(f"Neuralis Brain health check returned {response.status_code}")

            return self._available

        except Exception as e:
            PrintStyle().warning(f"Neuralis Brain unavailable: {str(e)}")
            self._available = False
            self._last_check = time.time()
            return False

    def query_utility(self, system: str, message: str) -> Optional[str]:
        """
        Query Neuralis Brain for utility model tasks.

        Args:
            system: System prompt
            message: User message

        Returns:
            str: Brain response or None if unavailable
        """
        if not self.is_available():
            return None

        try:
            response = requests.post(
                f"{self.base_url}/api/v1/utility",
                json={
                    "system": system,
                    "message": message
                },
                timeout=self.timeout
            )

            if response.status_code == 200:
                data = response.json()
                return data.get("response", "")

            else:
                PrintStyle().error(f"Neuralis Brain returned status {response.status_code}")
                return None

        except requests.Timeout:
            PrintStyle().error("Neuralis Brain request timed out")
            return None

        except requests.ConnectionError:
            PrintStyle().error("Neuralis Brain connection failed")
            return None

        except Exception as e:
            PrintStyle().error(f"Neuralis Brain query failed: {str(e)}")
            return None

    def query_embedding(self, texts: list[str]) -> Optional[list[list[float]]]:
        """
        Query Neuralis Brain for embeddings.

        Args:
            texts: List of texts to embed

        Returns:
            List of embedding vectors or None if unavailable
        """
        if not self.is_available():
            return None

        try:
            response = requests.post(
                f"{self.base_url}/api/v1/embeddings",
                json={"texts": texts},
                timeout=self.timeout
            )

            if response.status_code == 200:
                data = response.json()
                return data.get("embeddings", [])

            else:
                PrintStyle().error(f"Neuralis Brain embeddings returned status {response.status_code}")
                return None

        except Exception as e:
            PrintStyle().error(f"Neuralis Brain embeddings failed: {str(e)}")
            return None


# Global instance
_brain_client = None

def get_brain_client() -> BrainClient:
    """Get or create global BrainClient instance."""
    global _brain_client
    if _brain_client is None:
        _brain_client = BrainClient()
    return _brain_client
