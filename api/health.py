from helpers.api import ApiHandler, Request, Response
from helpers import errors, git
import time

class HealthCheck(ApiHandler):

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
        gitinfo = None
        system = {}
        try:
            gitinfo = git.get_git_info()
            import psutil
            import os
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            system = {
                "version": "2.0.0",
                "cpu": cpu_percent,
                "memory": memory.percent,
                "status": "healthy",
                "timestamp": time.time()
            }
        except ImportError:
            system = {"version": "2.0.0", "status": "limited", "message": "psutil not available"}
        except Exception as e:
            error = errors.error_text(e)

        return {"gitinfo": gitinfo, "system": system, "error": error, "data": system, "status": "ok"}
