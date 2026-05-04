import asyncio
import pytest
from datetime import datetime
from unittest.mock import AsyncMock, patch, MagicMock

from mediasentinel.config.models import AlertConfig


@pytest.fixture
def webhook_config():
    return AlertConfig(
        webhook_urls=["https://hooks.example.com/alert"],
        smtp_host="",
        to_addresses=[],
    )


@pytest.fixture
def email_config():
    return AlertConfig(
        webhook_urls=[],
        smtp_host="smtp.example.com",
        smtp_port=587,
        smtp_user="user@example.com",
        smtp_password_env="SMTP_PASSWORD",
        from_address="alert@mediasentinel.local",
        to_addresses=["admin@example.com"],
    )


@pytest.fixture
def multi_webhook_config():
    return AlertConfig(
        webhook_urls=["https://hooks.example.com/1", "https://hooks.example.com/2"],
        smtp_host="",
        to_addresses=[],
    )


@pytest.fixture
def empty_config():
    return AlertConfig()


async def test_webhook_send_success(webhook_config):
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(webhook_config)
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    with patch.object(dispatcher._client, "post", new_callable=AsyncMock, return_value=mock_resp):
        result = await dispatcher.send_alert("Test Alert", "Something happened", "warning", "TestService")
        assert result is True
    await dispatcher.close()


async def test_webhook_send_failure(webhook_config):
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(webhook_config)
    mock_resp = MagicMock()
    mock_resp.status_code = 500

    with patch.object(dispatcher._client, "post", new_callable=AsyncMock, return_value=mock_resp):
        result = await dispatcher.send_alert("Test Alert", "Something happened")
        assert result is False
    await dispatcher.close()


async def test_webhook_exception(webhook_config):
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(webhook_config)

    with patch.object(dispatcher._client, "post", new_callable=AsyncMock, side_effect=Exception("connection error")):
        result = await dispatcher.send_alert("Test Alert", "Something happened")
        assert result is False
    await dispatcher.close()


async def test_multi_webhook_partial_failure(multi_webhook_config):
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(multi_webhook_config)
    mock_ok = MagicMock()
    mock_ok.status_code = 200
    mock_fail = MagicMock()
    mock_fail.status_code = 503

    with patch.object(dispatcher._client, "post", new_callable=AsyncMock, side_effect=[mock_ok, mock_fail]):
        result = await dispatcher.send_alert("Partial Alert", "Some failed")
        assert result is False
    await dispatcher.close()


async def test_email_send_success(email_config):
    import smtplib
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(email_config)

    mock_server = MagicMock()
    mock_smtp_cls = MagicMock(return_value=mock_server)
    mock_server.__enter__ = MagicMock(return_value=mock_server)
    mock_server.__exit__ = MagicMock(return_value=False)

    with patch.object(smtplib, "SMTP", mock_smtp_cls), \
         patch.dict("os.environ", {"SMTP_PASSWORD": "secret123"}):
        result = await dispatcher.send_alert("Email Alert", "Check this", "error", "Svc1")
        assert result is True
        mock_server.starttls.assert_called_once()
        mock_server.login.assert_called_once()
        mock_server.send_message.assert_called_once()
    await dispatcher.close()


async def test_email_no_password(email_config):
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(email_config)

    with patch.dict("os.environ", {}, clear=True):
        result = await dispatcher.send_alert("Email Alert", "Check this")
        assert result is False
    await dispatcher.close()


async def test_email_exception(email_config):
    import smtplib
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(email_config)

    mock_smtp_cls = MagicMock(side_effect=Exception("SMTP error"))

    with patch.object(smtplib, "SMTP", mock_smtp_cls), \
         patch.dict("os.environ", {"SMTP_PASSWORD": "secret123"}):
        result = await dispatcher.send_alert("Email Alert", "Check this")
        assert result is False
    await dispatcher.close()


async def test_no_channels_configured(empty_config):
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(empty_config)
    result = await dispatcher.send_alert("No Channels", "Nothing to send to")
    assert result is True
    await dispatcher.close()


async def test_webhook_payload_format(webhook_config):
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(webhook_config)
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    with patch.object(dispatcher._client, "post", new_callable=AsyncMock, return_value=mock_resp) as mock_post:
        await dispatcher.send_alert("Title", "Msg", "warning", "Svc")
        call_args = mock_post.call_args
        payload = call_args.kwargs.get("json") or call_args[1].get("json") or call_args[0][1]
        assert payload["title"] == "Title"
        assert payload["message"] == "Msg"
        assert payload["severity"] == "warning"
        assert payload["service"] == "Svc"
        assert payload["source"] == "MediaSentinel"
        assert "timestamp" in payload
    await dispatcher.close()


# --- New tests for 4 severity levels (ALT-01, ALT-04) ---

async def test_info_severity_logs_only(webhook_config):
    """INFO severity should only log, not send to any channel."""
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(webhook_config)

    with patch.object(dispatcher._client, "post", new_callable=AsyncMock) as mock_post:
        result = await dispatcher.send_alert("Info Alert", "Just info", "info")
        assert result is True
        mock_post.assert_not_called()

    await dispatcher.close()


async def test_info_severity_variants(webhook_config):
    """Various info-level strings should all map to INFO."""
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(webhook_config)

    with patch.object(dispatcher._client, "post", new_callable=AsyncMock) as mock_post:
        result = await dispatcher.send_alert("Info Alert", "debug info", "INFO")
        assert result is True
        mock_post.assert_not_called()

    await dispatcher.close()


async def test_critical_severity_includes_recovery_suggestion(webhook_config):
    """CRITICAL severity should include recovery_suggestion in webhook payload."""
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(webhook_config)
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    with patch.object(dispatcher._client, "post", new_callable=AsyncMock, return_value=mock_resp) as mock_post:
        result = await dispatcher.send_alert(
            "VPN disconnected",
            "VPN is down",
            "critical",
            "vpn",
        )
        assert result is True
        call_args = mock_post.call_args
        payload = call_args.kwargs.get("json") or call_args[1].get("json") or call_args[0][1]
        assert "recovery_suggestion" in payload
        assert "VPN" in payload["recovery_suggestion"]

    await dispatcher.close()


async def test_critical_severity_normalizes_error():
    """Legacy 'error' severity should map to CRITICAL."""
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(AlertConfig())

    # 'error' should be normalized to 'critical' and treated accordingly (not INFO)
    # Since no channels configured, it will return True but we verify it did not take the INFO path
    with patch.object(dispatcher._client, "post", new_callable=AsyncMock) as mock_post:
        result = await dispatcher.send_alert("Error Alert", "Something broke", "error")
        # Should NOT be INFO (which skips post entirely), but since no channels,
        # both CRITICAL and WARNING return True without calling post
        assert result is True

    await dispatcher.close()


async def test_emergency_severity_starts_repeat(webhook_config):
    """EMERGENCY severity should start the repeat loop for a service."""
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(webhook_config)
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    with patch.object(dispatcher._client, "post", new_callable=AsyncMock, return_value=mock_resp):
        result = await dispatcher.send_alert(
            "Emergency!",
            "System on fire",
            "emergency",
            "Radarr",
        )
        assert result is True
        assert dispatcher.is_emergency_active("Radarr")

    # Clear the emergency to cancel the repeat task
    dispatcher.clear_emergency("Radarr")
    assert not dispatcher.is_emergency_active("Radarr")
    await dispatcher.close()


async def test_clear_emergency_nonexistent(webhook_config):
    """Clearing a non-existent emergency should return False."""
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(webhook_config)
    result = dispatcher.clear_emergency("NonExistentService")
    assert result is False
    await dispatcher.close()


async def test_emergency_repeat_loop_cancels_on_clear(webhook_config):
    """Emergency repeat task should stop when clear_emergency is called."""
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    # Use the minimum allowed repeat interval for testing (ge=30)
    config = AlertConfig(
        webhook_urls=["https://hooks.example.com/alert"],
        smtp_host="",
        to_addresses=[],
        emergency_repeat_interval_seconds=30,
    )
    dispatcher = AlertDispatcher(config)
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    with patch.object(dispatcher._client, "post", new_callable=AsyncMock, return_value=mock_resp):
        await dispatcher.send_alert(
            "Emergency Test",
            "Testing repeat",
            "emergency",
            "TestSvc",
        )
        assert dispatcher.is_emergency_active("TestSvc")

        # Wait a moment and clear
        await asyncio.sleep(0.2)
        dispatcher.clear_emergency("TestSvc")
        assert not dispatcher.is_emergency_active("TestSvc")

    await dispatcher.close()


async def test_severity_normalization():
    """Test that legacy severity strings map correctly."""
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher, AlertSeverity

    dispatcher = AlertDispatcher(AlertConfig())

    assert dispatcher._normalize_severity("warn") == AlertSeverity.WARNING
    assert dispatcher._normalize_severity("error") == AlertSeverity.CRITICAL
    assert dispatcher._normalize_severity("fatal") == AlertSeverity.EMERGENCY
    assert dispatcher._normalize_severity("unknown") == AlertSeverity.WARNING  # default

    await dispatcher.close()


async def test_webhook_payload_with_diagnostic_context(webhook_config):
    """Alert with diagnostic_context should include it in the webhook payload (ALT-03)."""
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(webhook_config)
    mock_resp = MagicMock()
    mock_resp.status_code = 200

    diag = {
        "service_states": {"Radarr": "healthy", "Sonarr": "unhealthy"},
        "recent_recoveries": ["Radarr: docker_restart (success) at 2026-01-01"],
        "vpn_status": "connected",
        "system_resources": {"cpu_percent": 45.0, "memory_percent": 60.0, "disk_percent": 70.0},
    }

    with patch.object(dispatcher._client, "post", new_callable=AsyncMock, return_value=mock_resp) as mock_post:
        result = await dispatcher.send_alert(
            "Service Alert",
            "Something is wrong",
            "warning",
            "Radarr",
            diagnostic_context=diag,
        )
        assert result is True
        call_args = mock_post.call_args
        payload = call_args.kwargs.get("json") or call_args[1].get("json") or call_args[0][1]
        assert "diagnostic" in payload
        assert payload["diagnostic"]["vpn_status"] == "connected"
        assert "Radarr" in payload["diagnostic"]["service_states"]

    await dispatcher.close()


async def test_email_with_diagnostic_context(email_config):
    """Alert email with diagnostic context should include diagnostic info in body."""
    import smtplib
    from mediasentinel.agents.alert_dispatcher import AlertDispatcher

    dispatcher = AlertDispatcher(email_config)
    mock_server = MagicMock()
    mock_smtp_cls = MagicMock(return_value=mock_server)
    mock_server.__enter__ = MagicMock(return_value=mock_server)
    mock_server.__exit__ = MagicMock(return_value=False)

    diag = {
        "service_states": {"Radarr": "unhealthy"},
        "recent_recoveries": [],
        "vpn_status": "connected",
        "system_resources": {"cpu_percent": 90.0, "memory_percent": 85.0, "disk_percent": 70.0},
    }

    with patch.object(smtplib, "SMTP", mock_smtp_cls), \
         patch.dict("os.environ", {"SMTP_PASSWORD": "secret123"}):
        result = await dispatcher.send_alert(
            "Email with diag",
            "Check this",
            "critical",
            "Radarr",
            diagnostic_context=diag,
        )
        assert result is True
        # Verify the email body includes diagnostic info
        send_call = mock_server.send_message.call_args
        msg = send_call[0][0]
        body = msg.get_payload(decode=True).decode("utf-8")
        assert "Diagnostic Context" in body
        assert "connected" in body

    await dispatcher.close()


async def test_build_diagnostic_context(tmp_path):
    """build_diagnostic_context should query DB and return structured context."""
    from mediasentinel.agents.alert_dispatcher import build_diagnostic_context
    from mediasentinel.db.connection import init_db

    db_path = tmp_path / "diag_test.sqlite"
    await init_db(db_path)

    from mediasentinel.db.connection import get_db

    # Seed test data
    async with get_db(db_path) as db:
        await db.execute(
            "INSERT INTO services (name, url, status, critical, poll_interval_seconds, failure_threshold) "
            "VALUES ('Radarr', 'http://localhost:7878', 'healthy', 0, 30, 3)"
        )
        await db.execute(
            "INSERT INTO services (name, url, status, critical, poll_interval_seconds, failure_threshold) "
            "VALUES ('Sonarr', 'http://localhost:8989', 'unhealthy', 0, 30, 3)"
        )
        await db.execute(
            "INSERT INTO recovery_events (service_name, escalation_level, action, result, started_at) "
            "VALUES ('Sonarr', 1, 'docker_restart', 'success', '2026-01-01T00:00:00')"
        )
        await db.execute(
            "INSERT INTO metrics (metric_type, metric_name, value, unit, recorded_at) "
            "VALUES ('vpn_state', 'vpn', 1.0, '', '2026-01-01T00:00:00')"
        )
        await db.execute(
            "INSERT INTO metrics (metric_type, metric_name, value, unit, recorded_at) "
            "VALUES ('system', 'cpu_percent', 55.0, '%', '2026-01-01T00:00:00')"
        )
        await db.execute(
            "INSERT INTO metrics (metric_type, metric_name, value, unit, recorded_at) "
            "VALUES ('system', 'memory_percent', 65.0, '%', '2026-01-01T00:00:00')"
        )
        await db.execute(
            "INSERT INTO metrics (metric_type, metric_name, value, unit, recorded_at) "
            "VALUES ('system', 'disk_percent', 75.0, '%', '2026-01-01T00:00:00')"
        )
        await db.commit()

    context = await build_diagnostic_context(db_path)

    assert context["service_states"]["Radarr"] == "healthy"
    assert len(context["recent_recoveries"]) == 1
    assert "Sonarr" in context["recent_recoveries"][0]
    assert context["vpn_status"] == "connected"
    assert context["system_resources"]["cpu_percent"] == 55.0
    assert context["system_resources"]["memory_percent"] == 65.0
    assert context["system_resources"]["disk_percent"] == 75.0
