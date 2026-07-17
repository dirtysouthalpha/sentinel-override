"""Config loader for Auto Headroom plugin."""
import os
import yaml


DEFAULT_CONFIG = {
    "compact_threshold": 0.75,
    "warn_threshold": 0.50,
    "min_messages": 6,
    "use_chat_model_for_compaction": False,
    "log_warnings": True,
}


def _get_config_path():
    """Find the plugin config file."""
    # Check for user override in usr/plugins/
    plugin_name = "_auto_headroom"
    base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    default_config = os.path.join(base, "default_config.yaml")
    return default_config


def get_config(agent=None):
    """Load config from default_config.yaml, falling back to hardcoded defaults."""
    try:
        config_path = _get_config_path()
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                loaded = yaml.safe_load(f) or {}
            # Merge with defaults
            result = {**DEFAULT_CONFIG, **loaded}
            return result
    except Exception:
        pass
    return DEFAULT_CONFIG.copy()
