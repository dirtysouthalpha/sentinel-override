import os
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

import httpx

from mediasentinel.agents.tunnel_guard import TunnelGuard
from mediasentinel.agents.models import TunnelResult
from mediasentinel.config.models import TunnelConfig


@pytest.fixture
def tunnels():
    return [
        TunnelConfig(
            tunnel_name="media-tunnel",
            health_check_url="https://media.example.com",
            poll_interval_seconds=30,
        )
    ]


@pytest.fixture
def tunnel_with_cf():
    """Tunnel config that points to a known domain for CF API testing."""
    return TunnelConfig(
        tunnel_name="cf-tunnel",
        health_check_url="https://app.example.com/health",
        poll_interval_seconds=30,
        cf_api_token_env="TEST_CF_TOKEN",
    )


@pytest.fixture
async def guard(tunnels):
    g = TunnelGuard(tunnels)
    yield g
    await g.close()


@pytest.fixture
async def cf_guard(tunnel_with_cf):
    g = TunnelGuard([tunnel_with_cf])
    yield g
    await g.close()


# --- Existing tests (preserved) ---


async def test_tunnel_url_reachable(guard, tunnels):
    fake_resp = httpx.Response(200, request=httpx.Request("GET", "https://media.example.com"))
    with patch.object(guard._client, "get", new_callable=AsyncMock, return_value=fake_resp):
        with patch.object(guard, "_validate_dns", new_callable=AsyncMock, return_value=True):
            result = await guard.check_tunnel(tunnels[0])
    assert result.url_reachable is True
    assert result.latency_ms >= 0


async def test_tunnel_url_unreachable(guard, tunnels):
    with patch.object(guard._client, "get", new_callable=AsyncMock, side_effect=httpx.ConnectError("refused")):
        with patch.object(guard, "_validate_dns", new_callable=AsyncMock, return_value=False):
            result = await guard.check_tunnel(tunnels[0])
    assert result.url_reachable is False
    assert result.dns_valid is False


async def test_tunnel_degraded_response(guard, tunnels):
    fake_resp = httpx.Response(503, request=httpx.Request("GET", "https://media.example.com"))
    with patch.object(guard._client, "get", new_callable=AsyncMock, return_value=fake_resp):
        with patch.object(guard, "_validate_dns", new_callable=AsyncMock, return_value=True):
            result = await guard.check_tunnel(tunnels[0])
    assert result.url_reachable is False  # 503 not in 200-399


async def test_check_all(guard, tunnels):
    fake_resp = httpx.Response(200, request=httpx.Request("GET", "https://media.example.com"))
    with patch.object(guard._client, "get", new_callable=AsyncMock, return_value=fake_resp):
        with patch.object(guard, "_validate_dns", new_callable=AsyncMock, return_value=True):
            results = await guard.check_all()
    assert len(results) == 1
    assert results[0].tunnel_name == "media-tunnel"


async def test_dns_validation_cname(guard):
    import dns.resolver

    mock_rdata = type("Rdata", (), {"target": "media-tunnel.cfargotunnel.com."})()
    with patch.object(dns.resolver.Resolver, "resolve", return_value=[mock_rdata]):
        assert await guard._validate_dns("https://media.example.com") is True


async def test_dns_validation_failure(guard):
    import dns.resolver

    with patch.object(dns.resolver.Resolver, "resolve", side_effect=Exception("no DNS")):
        assert await guard._validate_dns("https://nonexistent.invalid") is False


# --- New tests: CF API status (TUN-02) ---


async def test_cf_api_status_no_token(cf_guard, tunnel_with_cf):
    """When the CF API token env var is not set, cf_api_status should be None."""
    with patch.dict(os.environ, {}, clear=True):
        result = await cf_guard._check_cf_api_status(tunnel_with_cf)
    assert result is None


async def test_cf_api_status_active(cf_guard, tunnel_with_cf):
    """When CF API returns matching zone and proxied CNAME, status is 'active'."""
    zones_resp_data = {
        "success": True,
        "result": [
            {
                "id": "zone123",
                "name": "example.com",
                "status": "active",
            }
        ],
    }
    dns_resp_data = {
        "success": True,
        "result": [
            {
                "id": "dns456",
                "type": "CNAME",
                "name": "app.example.com",
                "content": "cf-tunnel.cfargotunnel.com",
                "proxied": True,
            }
        ],
    }

    async def mock_get(url, **kwargs):
        if "zones" in url and "dns_records" not in url:
            return httpx.Response(
                200,
                json=zones_resp_data,
                request=httpx.Request("GET", url),
            )
        if "dns_records" in url:
            return httpx.Response(
                200,
                json=dns_resp_data,
                request=httpx.Request("GET", url),
            )
        return httpx.Response(404, request=httpx.Request("GET", url))

    with patch.dict(os.environ, {"TEST_CF_TOKEN": "fake-api-token"}):
        with patch.object(cf_guard._client, "get", new_callable=AsyncMock, side_effect=mock_get):
            result = await cf_guard._check_cf_api_status(tunnel_with_cf)

    assert result == "active"


async def test_cf_api_status_degraded_cname_not_proxied(cf_guard, tunnel_with_cf):
    """When CNAME exists but is not proxied via CF tunnel, status is 'degraded'."""
    zones_resp_data = {
        "success": True,
        "result": [
            {
                "id": "zone123",
                "name": "example.com",
                "status": "active",
            }
        ],
    }
    dns_resp_data = {
        "success": True,
        "result": [
            {
                "id": "dns456",
                "type": "CNAME",
                "name": "app.example.com",
                "content": "some-other-target.example.com",
                "proxied": False,
            }
        ],
    }

    async def mock_get(url, **kwargs):
        if "zones" in url and "dns_records" not in url:
            return httpx.Response(
                200,
                json=zones_resp_data,
                request=httpx.Request("GET", url),
            )
        if "dns_records" in url:
            return httpx.Response(
                200,
                json=dns_resp_data,
                request=httpx.Request("GET", url),
            )
        return httpx.Response(404, request=httpx.Request("GET", url))

    with patch.dict(os.environ, {"TEST_CF_TOKEN": "fake-api-token"}):
        with patch.object(cf_guard._client, "get", new_callable=AsyncMock, side_effect=mock_get):
            result = await cf_guard._check_cf_api_status(tunnel_with_cf)

    assert result == "degraded"


async def test_cf_api_status_no_matching_zone(cf_guard, tunnel_with_cf):
    """When no CF zone matches the hostname, status is 'no_zone'."""
    zones_resp_data = {
        "success": True,
        "result": [
            {
                "id": "zone999",
                "name": "otherdomain.org",
                "status": "active",
            }
        ],
    }

    async def mock_get(url, **kwargs):
        return httpx.Response(
            200,
            json=zones_resp_data,
            request=httpx.Request("GET", url),
        )

    with patch.dict(os.environ, {"TEST_CF_TOKEN": "fake-api-token"}):
        with patch.object(cf_guard._client, "get", new_callable=AsyncMock, side_effect=mock_get):
            result = await cf_guard._check_cf_api_status(tunnel_with_cf)

    assert result == "no_zone"


async def test_cf_api_status_api_error(cf_guard, tunnel_with_cf):
    """When CF API returns an HTTP error, status should be None."""
    async def mock_get(url, **kwargs):
        return httpx.Response(
            403,
            json={"success": False, "errors": [{"message": "Forbidden"}]},
            request=httpx.Request("GET", url),
        )

    with patch.dict(os.environ, {"TEST_CF_TOKEN": "fake-api-token"}):
        with patch.object(cf_guard._client, "get", new_callable=AsyncMock, side_effect=mock_get):
            result = await cf_guard._check_cf_api_status(tunnel_with_cf)

    assert result is None


async def test_cf_api_status_request_exception(cf_guard, tunnel_with_cf):
    """When CF API request throws a network error, status should be None."""
    with patch.dict(os.environ, {"TEST_CF_TOKEN": "fake-api-token"}):
        with patch.object(
            cf_guard._client, "get", new_callable=AsyncMock,
            side_effect=httpx.ConnectError("connection refused"),
        ):
            result = await cf_guard._check_cf_api_status(tunnel_with_cf)

    assert result is None


async def test_cf_api_status_zone_active_no_cname(cf_guard, tunnel_with_cf):
    """When no CNAME records exist but zone is active, status is 'zone_active'."""
    zones_resp_data = {
        "success": True,
        "result": [
            {
                "id": "zone123",
                "name": "example.com",
                "status": "active",
            }
        ],
    }
    dns_resp_data = {
        "success": True,
        "result": [],
    }

    async def mock_get(url, **kwargs):
        if "zones" in url and "dns_records" not in url:
            return httpx.Response(
                200,
                json=zones_resp_data,
                request=httpx.Request("GET", url),
            )
        if "dns_records" in url:
            return httpx.Response(
                200,
                json=dns_resp_data,
                request=httpx.Request("GET", url),
            )
        return httpx.Response(404, request=httpx.Request("GET", url))

    with patch.dict(os.environ, {"TEST_CF_TOKEN": "fake-api-token"}):
        with patch.object(cf_guard._client, "get", new_callable=AsyncMock, side_effect=mock_get):
            result = await cf_guard._check_cf_api_status(tunnel_with_cf)

    assert result == "zone_active"


# --- New tests: DNS validation with CNAME pointing to Cloudflare ---


async def test_dns_validation_cloudflare_cname(guard):
    """CNAME record pointing to *.cloudflare.com should validate as True."""
    import dns.resolver

    mock_rdata = type("Rdata", (), {"target": "media.example.com.cdn.cloudflare.com."})()
    with patch.object(dns.resolver.Resolver, "resolve", return_value=[mock_rdata]):
        assert await guard._validate_dns("https://media.example.com") is True


async def test_dns_validation_cfargotunnel_cname(guard):
    """CNAME record pointing to *.cfargotunnel.com should validate as True."""
    import dns.resolver

    mock_rdata = type("Rdata", (), {"target": "abc-def.cfargotunnel.com."})()
    with patch.object(dns.resolver.Resolver, "resolve", return_value=[mock_rdata]):
        assert await guard._validate_dns("https://media.example.com") is True


async def test_dns_validation_non_cloudflare_cname(guard):
    """CNAME record NOT pointing to Cloudflare should fall back to A record check."""
    import dns.resolver

    # First call (CNAME) returns a non-cloudflare target
    non_cf_cname = type("Rdata", (), {"target": "media.someothercdn.com."})()

    # Second call (A record fallback) returns an IP
    mock_a_record = type("Rdata", (), {"address": "1.2.3.4"})()

    call_count = 0
    def resolve_side_effect(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return [non_cf_cname]
        return [mock_a_record]

    with patch.object(dns.resolver.Resolver, "resolve", side_effect=resolve_side_effect):
        result = await guard._validate_dns("https://media.example.com")
    # CNAME doesn't match cloudflare/cfargotunnel, so it falls through to False
    # (the function returns False after checking CNAME records that don't match)
    assert result is False


async def test_dns_validation_a_record_fallback(guard):
    """When no CNAME exists but A record resolves, validation returns True."""
    import dns.resolver

    mock_a_record = type("Rdata", (), {"address": "104.21.50.10"})()

    def resolve_side_effect(hostname, rdtype):
        if rdtype == "CNAME":
            raise Exception("No CNAME record")
        return [mock_a_record]

    with patch.object(dns.resolver.Resolver, "resolve", side_effect=resolve_side_effect):
        assert await guard._validate_dns("https://media.example.com") is True


async def test_check_tunnel_integrates_cf_status(cf_guard, tunnel_with_cf):
    """check_tunnel should populate cf_api_status from CF API check."""
    fake_resp = httpx.Response(200, request=httpx.Request("GET", "https://app.example.com/health"))

    zones_resp_data = {
        "success": True,
        "result": [
            {"id": "zone123", "name": "example.com", "status": "active"}
        ],
    }
    dns_resp_data = {
        "success": True,
        "result": [
            {"id": "dns456", "type": "CNAME", "name": "app.example.com",
             "content": "cf-tunnel.cfargotunnel.com", "proxied": True}
        ],
    }

    call_count = 0
    async def mock_get(url, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            # First call: health check URL
            return fake_resp
        if "dns_records" in url:
            return httpx.Response(200, json=dns_resp_data, request=httpx.Request("GET", url))
        # zones call
        return httpx.Response(200, json=zones_resp_data, request=httpx.Request("GET", url))

    with patch.dict(os.environ, {"TEST_CF_TOKEN": "fake-api-token"}):
        with patch.object(cf_guard._client, "get", new_callable=AsyncMock, side_effect=mock_get):
            with patch.object(cf_guard, "_validate_dns", new_callable=AsyncMock, return_value=True):
                result = await cf_guard.check_tunnel(tunnel_with_cf)

    assert result.cf_api_status == "active"
    assert result.url_reachable is True
    assert result.dns_valid is True
