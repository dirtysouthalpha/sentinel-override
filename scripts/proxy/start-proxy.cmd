@echo off
:: Sentinel Proxy Watchdog — monitors and auto-restarts the proxy
title Sentinel Proxy Watchdog
powershell -ExecutionPolicy Bypass -File "C:\Users\Administrator\.claude\proxy\watchdog-proxy.ps1"
