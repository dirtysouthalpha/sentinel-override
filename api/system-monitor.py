from helpers.api import ApiHandler, Request, Response
from helpers import errors
import time

class SystemMonitor(ApiHandler):

    @classmethod
    def requires_auth(cls) -> bool:
        return False

    @classmethod
    def requires_csrf(cls) -> bool:
        return False

    @classmethod
    def get_methods(cls) -> list[str]:
        return ["GET", "POST"]

    async def process(self, input: dict, request: Request) -> dict | Response:
        error = None
        report = {}
        
        action = input.get("action", "get_report") if isinstance(input, dict) else "get_report"
        
        try:
            import psutil
            import os
            
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage("/")
            
            report = {
                "status": "healthy",
                "timestamp": time.time(),
                "cpu": {
                    "usage_percent": cpu_percent,
                    "cores": psutil.cpu_count(),
                },
                "memory": memory.percent,
                "disk": disk.percent,
                "uptime": time.time() - psutil.boot_time(),
                "python_version": os.sys.version
            }
        except ImportError:
            report = {"status": "warning", "message": "psutil not installed, limited metrics"}
        except Exception as e:
            error = errors.error_text(e)
            report = {"status": "error", "message": str(e)}

        return {"data": report, "error": error}
