from helpers.api import ApiHandler, Request, Response
from helpers import errors

class SystemMetrics(ApiHandler):

    @classmethod
    def requires_auth(cls) -> bool:
        return False

    @classmethod
    def requires_csrf(cls) -> bool:
        return False

    @classmethod
    def get_methods(cls) -> list[str]:
        return ["GET"]

    async def process(self, input: dict, request: Request) -> dict | Response:
        error = None
        metrics = {}
        try:
            import psutil
            import os
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage("/")
            metrics = {
                "cpu": {
                    "usage_percent": cpu_percent,
                    "cores": psutil.cpu_count(),
                    "load_avg": os.getloadavg()
                },
                "memory": {
                    "total_mb": memory.total // (1024 * 1024),
                    "available_mb": memory.available // (1024 * 1024),
                    "used_mb": memory.used // (1024 * 1024),
                    "usage_percent": memory.percent
                },
                "disk": {
                    "total_gb": disk.total // (1024 * 1024 * 1024),
                    "used_gb": disk.used // (1024 * 1024 * 1024),
                    "free_gb": disk.free // (1024 * 1024 * 1024),
                    "usage_percent": disk.percent
                }
            }
        except ImportError:
            error = "psutil not installed"
        except Exception as e:
            error = errors.error_text(e)

        return {"data": metrics, "error": error}
