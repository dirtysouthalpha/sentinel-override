"""
Error Handling Configuration for Agent Zero
Centralized error handling patterns and fallback strategies.
"""

from typing import Optional, Callable, Any
from helpers.print_style import PrintStyle


class ErrorHandlingConfig:
    """Configuration for error handling behavior across Agent Zero."""

    # Retry configuration
    MAX_RETRIES = 3
    INITIAL_RETRY_DELAY = 1.5  # seconds
    MAX_RETRY_DELAY = 30  # seconds
    EXPONENTIAL_BACKOFF = True

    # Rate limiting handling
    RATE_LIMIT_DETECTION_KEYWORDS = ["rate", "limit", "quota", "429"]
    RATE_LIMIT_BACKOFF_MULTIPLIER = 2  # Exponential backoff for rate limits

    # Timeout configuration
    DEFAULT_LLM_TIMEOUT = 30  # seconds
    MEMORY_CONSOLIDATION_TIMEOUT = 60  # seconds
    BRAIN_FALLBACK_TIMEOUT = 10  # seconds

    # Fallback behavior
    ENABLE_BRAIN_FALLBACK = True
    ENABLE_GRACEFUL_DEGRADATION = True
    SUPPRESS_NON_CRITICAL_ERRORS = True

    # Logging configuration
    LOG_ALL_ERRORS = True
    LOG_RETRY_ATTEMPTS = True
    LOG_FALLBACK_ACTIVATION = True


class FallbackResponse:
    """Standard fallback responses for different LLM failure scenarios."""

    # Memory-related fallbacks
    MEMORY_KEYWORD_EXTRACTION = "[]"  # Empty list - no keywords
    MEMORY_CONSOLIDATION_SKIP = '{"action": "skip", "reasoning": "LLM call failed"}'
    MEMORY_FILTER_KEEP_ALL = None  # Will be set dynamically to keep all memories

    # Empty fallbacks
    EMPTY_STRING = ""
    EMPTY_JSON = "{}"
    EMPTY_LIST = "[]"


def handle_llm_error(
    error: Exception,
    operation: str,
    fallback_response: Optional[str] = None,
    critical: bool = False
) -> str:
    """
    Centralized error handling for LLM operations.

    Args:
        error: The exception that occurred
        operation: Description of the operation that failed
        fallback_response: Optional fallback response to return
        critical: Whether this is a critical error that should halt execution

    Returns:
        str: The fallback response or empty string
    """
    error_type = type(error).__name__
    error_msg = str(error)

    PrintStyle().error(f"LLM operation '{operation}' failed: {error_type}: {error_msg}")

    # Check for rate limiting errors
    if _is_rate_limit_error(error_msg):
        PrintStyle().warning("Rate limit detected, consider implementing exponential backoff")

    # Check for critical errors
    if critical:
        PrintStyle().error(f"Critical LLM failure in '{operation}', cannot continue")
        raise error

    # Return fallback response if available
    if fallback_response is not None:
        PrintStyle().warning(f"Using fallback response for '{operation}'")
        return fallback_response

    PrintStyle().warning(f"No fallback available for '{operation}', returning empty result")
    return FallbackResponse.EMPTY_STRING


def _is_rate_limit_error(error_msg: str) -> bool:
    """Check if error message indicates rate limiting."""
    error_msg_lower = error_msg.lower()
    return any(keyword in error_msg_lower for keyword in ErrorHandlingConfig.RATE_LIMIT_DETECTION_KEYWORDS)


def should_retry_error(error: Exception, attempt: int, max_retries: int) -> bool:
    """
    Determine if an error should trigger a retry.

    Args:
        error: The exception that occurred
        attempt: Current retry attempt
        max_retries: Maximum number of retries allowed

    Returns:
        bool: True if should retry, False otherwise
    """
    # Don't retry if we've exceeded max attempts
    if attempt >= max_retries:
        return False

    # Don't retry certain error types
    error_type = type(error).__name__
    if error_type in ["AuthenticationError", "PermissionError", "ValueError"]:
        return False

    # Retry on transient errors
    error_msg = str(error).lower()
    transient_keywords = ["timeout", "connection", "temporary", "unavailable", "network"]
    return any(keyword in error_msg for keyword in transient_keywords)


def get_retry_delay(attempt: int, initial_delay: float = None) -> float:
    """
    Calculate retry delay with exponential backoff.

    Args:
        attempt: Current retry attempt (0-indexed)
        initial_delay: Initial delay in seconds

    Returns:
        float: Delay in seconds
    """
    if initial_delay is None:
        initial_delay = ErrorHandlingConfig.INITIAL_RETRY_DELAY

    if ErrorHandlingConfig.EXPONENTIAL_BACKOFF:
        delay = initial_delay * (2 ** attempt)
    else:
        delay = initial_delay

    return min(delay, ErrorHandlingConfig.MAX_RETRY_DELAY)


def log_fallback_activation(operation: str, fallback_type: str):
    """Log when a fallback mechanism is activated."""
    if ErrorHandlingConfig.LOG_FALLBACK_ACTIVATION:
        PrintStyle().warning(f"Fallback activated for '{operation}': {fallback_type}")


def get_memory_fallback(fallback_type: str) -> str:
    """Get appropriate fallback response for memory operations."""
    fallbacks = {
        "keyword_extraction": FallbackResponse.MEMORY_KEYWORD_EXTRACTION,
        "consolidation": FallbackResponse.MEMORY_CONSOLIDATION_SKIP,
        "filter": FallbackResponse.MEMORY_FILTER_KEEP_ALL,
    }
    return fallbacks.get(fallback_type, FallbackResponse.EMPTY_STRING)
