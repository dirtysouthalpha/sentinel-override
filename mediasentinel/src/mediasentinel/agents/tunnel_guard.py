import asyncio
import os
import time
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

import httpx
from loguru import logger

from mediasentinel.agents.models import TunnelResult
from mediasentinel.config.models import TunnelConfig


class TunnelGuard:
    def __init__(self, tunnels: list[TunnelConfig]):
        self.tunnels = tunnels
        self._client = httpx.AsyncClient(timeout=15.0)

    async def close(self):
        await self._client.aclose()

    async def check_tunnel(self, tunnel: TunnelConfig) -> TunnelResult:
        log = logger.bind(component="TunnelGuard", action="check", tunnel=tunnel.tunnel_name)

        url_reachable = False
        latency_ms = 0.0
        dns_valid = False

        # Round-trip URL check
        start = time.monotonic()
        try:
            resp = await self._client.get(tunnel.health_check_url, follow_redirects=True)
            latency_ms = round((time.monotonic() - start) * 1000, 1)
            url_reachable = 200 <= resp.status_code < 400
            log.info(
                "url_check status={} latency={}ms",
                resp.status_code,
                latency_ms,
            )
        except httpx.RequestError as e:
            latency_ms = round((time.monotonic() - start) * 1000, 1)
            log.error("url_check failed: {}", e)

        # DNS validation
        dns_valid = await self._validate_dns(tunnel.health_check_url)
        if not dns_valid:
            log.warning("DNS validation failed for {}", tunnel.health_check_url)

        # Cloudflare API status verification (TUN-02)
        cf_status = await self._check_cf_api_status(tunnel)

        return TunnelResult(
            tunnel_name=tunnel.tunnel_name,
            url_reachable=url_reachable,
            cf_api_status=cf_status,
            dns_valid=dns_valid,
            latency_ms=latency_ms,
            checked_at=datetime.now(),
        )

    async def _check_cf_api_status(self, tunnel: TunnelConfig) -> Optional[str]:
        """Verify Cloudflare tunnel status via the CF API v4.

        Uses the zones endpoint to validate API token access, then confirms
        that the tunnel's hostname resolves to Cloudflare infrastructure.
        Returns a status string like "active" or "degraded", or None if the
        API token is not configured or the check cannot be performed.
        """
        log = logger.bind(component="TunnelGuard", action="cf_api_status", tunnel=tunnel.tunnel_name)

        api_token = os.environ.get(tunnel.cf_api_token_env)
        if not api_token:
            log.debug("CF API token not set in env var {}, skipping API check", tunnel.cf_api_token_env)
            return None

        headers = {
            "Authorization": f"Bearer {api_token}",
            "Content-Type": "application/json",
        }

        try:
            # Verify API token is valid by listing zones
            zones_resp = await self._client.get(
                "https://api.cloudflare.com/client/v4/zones",
                headers=headers,
                params={"per_page": 50},
            )
            if zones_resp.status_code != 200:
                log.warning("CF API zones request returned status {}", zones_resp.status_code)
                return None

            zones_body = zones_resp.json()
            if not zones_body.get("success"):
                errors = zones_body.get("errors", [])
                log.warning("CF API returned errors: {}", errors)
                return None

            zones = zones_body.get("result", [])
            if not zones:
                log.warning("CF API returned no zones; token may lack permissions")
                return None

            # Determine the hostname from the tunnel's health check URL
            hostname = urlparse(tunnel.health_check_url).hostname
            if not hostname:
                log.warning("Could not extract hostname from {}", tunnel.health_check_url)
                return None

            # Find the zone matching our hostname
            matched_zone = None
            for zone in zones:
                zone_name = zone.get("name", "")
                # Match if hostname ends with zone name (handles subdomain.example.com -> example.com)
                if hostname == zone_name or hostname.endswith("." + zone_name):
                    matched_zone = zone
                    break

            if not matched_zone:
                log.warning("No CF zone found matching hostname {}", hostname)
                return "no_zone"

            zone_id = matched_zone.get("id", "")

            # Check DNS records for the hostname within the matched zone to confirm tunnel is active
            dns_resp = await self._client.get(
                f"https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records",
                headers=headers,
                params={"name": hostname, "type": "CNAME"},
            )
            if dns_resp.status_code != 200:
                log.warning("CF API DNS records request returned status {}", dns_resp.status_code)
                return None

            dns_body = dns_resp.json()
            if not dns_body.get("success"):
                log.warning("CF API DNS records query failed")
                return None

            dns_records = dns_body.get("result", [])
            if not dns_records:
                # No CNAME found -- tunnel DNS may not be configured via CNAME
                # Check if the zone itself is active as a signal
                zone_status = matched_zone.get("status", "unknown")
                if zone_status == "active":
                    log.info("Zone active but no CNAME for {}; returning zone_active", hostname)
                    return "zone_active"
                return None

            # Examine CNAME records for cfargotunnel proxy
            for record in dns_records:
                cname_content = record.get("content", "").lower()
                record_proxied = record.get("proxied", False)
                if "cfargotunnel" in cname_content or record_proxied:
                    log.info("CF tunnel DNS confirmed active for {}", hostname)
                    return "active"

            # CNAME exists but not proxied through CF tunnel
            log.info("CNAME found for {} but not routed via cfargotunnel", hostname)
            return "degraded"

        except httpx.RequestError as e:
            log.error("CF API request failed: {}", e)
            return None
        except Exception as e:
            log.error("CF API status check unexpected error: {}", e)
            return None

    async def check_all(self) -> list[TunnelResult]:
        if not self.tunnels:
            return []
        return list(await asyncio.gather(*(self.check_tunnel(t) for t in self.tunnels)))

    async def _validate_dns(self, url: str) -> bool:
        try:
            import dns.resolver

            hostname = urlparse(url).hostname
            if not hostname:
                return False

            def _check_cname():
                res = dns.resolver.Resolver()
                res.lifetime = 5.0
                return res.resolve(hostname, "CNAME")

            answers = await asyncio.to_thread(_check_cname)
            for rdata in answers:
                target = str(rdata.target).rstrip(".")
                if "cloudflare" in target.lower() or "cfargotunnel" in target.lower():
                    return True
            return False
        except Exception:
            try:
                import dns.resolver

                hostname = urlparse(url).hostname
                if not hostname:
                    return False

                def _check_a():
                    res = dns.resolver.Resolver()
                    res.lifetime = 5.0
                    return res.resolve(hostname, "A")

                answers = await asyncio.to_thread(_check_a)
                return len(answers) > 0
            except Exception:
                return False

    async def restart_cloudflared(self) -> bool:
        import asyncio

        log = logger.bind(component="TunnelGuard", action="restart_cloudflared")
        try:
            proc = await asyncio.create_subprocess_exec(
                "cloudflared", "service", "restart",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
                if proc.returncode == 0:
                    log.info("cloudflared restarted successfully")
                    return True
                else:
                    log.error("cloudflared restart failed: {}", stderr.decode().strip())
                    return False
            except asyncio.TimeoutError:
                proc.kill()
                log.error("cloudflared restart timed out")
                return False
        except FileNotFoundError:
            log.error("cloudflared not found on PATH")
            return False
