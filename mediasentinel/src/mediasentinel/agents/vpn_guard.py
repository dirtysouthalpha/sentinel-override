import asyncio
import time
from typing import Optional

import httpx
import psutil
from loguru import logger

from mediasentinel.agents.models import VPNState, VPNStatus
from mediasentinel.config.models import VPNConfig


class VPNGuard:
    def __init__(self, config: VPNConfig):
        self.config = config
        self.state = VPNState.DISCONNECTED
        self._last_status: Optional[VPNStatus] = None
        self._client = httpx.AsyncClient(timeout=10.0)

    async def close(self):
        await self._client.aclose()

    async def check_status(self) -> VPNStatus:
        log = logger.bind(component="VPNGuard", action="check")

        adapter_info = self._detect_adapter()
        if adapter_info is None:
            self.state = VPNState.DISCONNECTED
            status = VPNStatus(state=VPNState.DISCONNECTED)
            log.warning("VPN adapter not found", adapter=self.config.adapter_description)
            self._last_status = status
            return status

        adapter_name, is_up, local_ip = adapter_info
        if not is_up:
            self.state = VPNState.DISCONNECTED
            status = VPNStatus(
                state=VPNState.DISCONNECTED,
                adapter_name=adapter_name,
                local_ip=local_ip,
            )
            log.warning("VPN adapter down", adapter=adapter_name)
            self._last_status = status
            return status

        start = time.monotonic()
        external_ip = await self._get_external_ip()
        latency_ms = round((time.monotonic() - start) * 1000, 1)

        dns_leak = await self._dns_leak_test()
        ip_leak = False
        if external_ip and self.config.expected_endpoint:
            ip_leak = external_ip != self.config.expected_endpoint

        if dns_leak or ip_leak:
            self.state = VPNState.DEGRADED
        else:
            self.state = VPNState.CONNECTED

        status = VPNStatus(
            state=self.state,
            adapter_name=adapter_name,
            local_ip=local_ip,
            external_ip=external_ip,
            latency_ms=latency_ms,
            dns_leak=dns_leak,
            ip_leak=ip_leak,
        )
        log.info(
            "status={state} ip={external_ip} latency={latency_ms}ms dns_leak={dns_leak}",
            state=self.state.value,
            external_ip=external_ip,
            latency_ms=latency_ms,
            dns_leak=dns_leak,
        )
        self._last_status = status
        return status

    def _detect_adapter(self) -> Optional[tuple[str, bool, Optional[str]]]:
        log = logger.bind(component="VPNGuard", action="detect_adapter")
        target = self.config.adapter_description.lower()

        addrs = psutil.net_if_addrs()
        stats = psutil.net_if_stats()

        for iface_name, iface_addrs in addrs.items():
            for addr in iface_addrs:
                if addr.family == -1:
                    continue
            # Check interface description by matching via stats
            iface_stat = stats.get(iface_name)
            if iface_stat is None:
                continue

            # On Windows, psutil uses the interface description as the name
            if target in iface_name.lower():
                is_up = iface_stat.isup
                local_ip = None
                for a in iface_addrs:
                    if a.family == 2:  # AF_INET
                        local_ip = a.address
                        break
                log.info("found adapter={} up={} ip={}", iface_name, is_up, local_ip)
                return (iface_name, is_up, local_ip)

        return None

    async def _get_external_ip(self) -> Optional[str]:
        try:
            resp = await self._client.get("https://api.ipify.org")
            if resp.status_code == 200:
                return resp.text.strip()
        except Exception:
            pass
        return None

    async def _get_vpn_ip(self) -> Optional[str]:
        """Return the external IP when VPN is connected, for leak test comparison."""
        return await self._get_external_ip()

    async def _dns_leak_test(self) -> bool:
        """Returns True if DNS leak detected (queries NOT going through VPN).

        Queries a leak-test service that echoes back the requesting IP in a TXT
        record. If the echoed IP matches our VPN external IP, DNS is routing
        through the tunnel. Otherwise, queries are leaking outside VPN.
        """
        try:
            import dns.resolver

            external_ip = await self._get_external_ip()
            if not external_ip:
                return True  # Can't verify — assume leak

            resolver = dns.resolver.Resolver()
            resolver.nameservers = ["1.1.1.1", "8.8.8.8"]
            resolver.lifetime = 5.0

            answers = resolver.resolve("whoami.ds.akahelp.net", "TXT")
            for rdata in answers:
                txt = rdata.to_text()
                # TXT record contains the IP that the DNS resolver saw
                if external_ip in txt:
                    return False  # DNS request routed through VPN
            # None of the DNS responses matched our VPN IP — leak
            return True
        except Exception:
            return True  # DNS resolution failed = potential leak
