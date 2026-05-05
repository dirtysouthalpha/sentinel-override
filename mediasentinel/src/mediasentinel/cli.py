import asyncio
import os
from pathlib import Path

import click

from mediasentinel.config.loader import load_config, ConfigLoadError
from mediasentinel.core.orchestrator import Orchestrator


@click.group()
@click.option("--config", "-c", default="config.yaml", help="Path to config file")
@click.option("--verbose", "-v", is_flag=True, help="Enable debug logging")
@click.pass_context
def cli(ctx, config, verbose):
    ctx.ensure_object(dict)
    ctx.obj["config_path"] = config
    ctx.obj["verbose"] = verbose


@cli.command()
@click.pass_context
def start(ctx):
    try:
        config = load_config(Path(ctx.obj["config_path"]))
    except ConfigLoadError as e:
        click.echo(f"Error: {e}", err=True)
        ctx.exit(1)
        return

    click.echo("Starting MediaSentinel...")
    orchestrator = Orchestrator(config)
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(orchestrator.start())
    except KeyboardInterrupt:
        loop.run_until_complete(orchestrator.shutdown())
    finally:
        loop.close()


@cli.command()
@click.pass_context
def status(ctx):
    try:
        config = load_config(Path(ctx.obj["config_path"]))
    except ConfigLoadError as e:
        click.echo(f"Error: {e}", err=True)
        ctx.exit(1)
        return

    async def _show_status():
        from mediasentinel.db.connection import get_db

        db_path = Path(os.path.expandvars(config.database.db_path))
        if not db_path.exists():
            click.echo("Database not found. Run 'mediasentinel start' first.")
            return

        async with get_db(db_path) as db:
            cursor = await db.execute(
                "SELECT name, status, response_time_ms, last_check_at FROM services ORDER BY name"
            )
            rows = await cursor.fetchall()

        if not rows:
            click.echo("No services in database.")
            return

        click.echo(f"{'Service':<25} {'Status':<12} {'Response':<12} {'Last Check'}")
        click.echo("-" * 70)
        for row in rows:
            status_val = row["status"] or "unknown"
            resp = f"{row['response_time_ms']:.1f}ms" if row["response_time_ms"] else "-"
            last = row["last_check_at"] or "never"
            click.echo(f"{row['name']:<25} {status_val:<12} {resp:<12} {last}")

    asyncio.run(_show_status())


@cli.command()
@click.pass_context
def logs(ctx):
    try:
        config = load_config(Path(ctx.obj["config_path"]))
    except ConfigLoadError as e:
        click.echo(f"Error: {e}", err=True)
        ctx.exit(1)
        return
    click.echo(f"Log directory: {config.logging.log_dir}")


@cli.command()
@click.argument("service_name", required=False)
@click.pass_context
def recover(ctx, service_name):
    try:
        config = load_config(Path(ctx.obj["config_path"]))
    except ConfigLoadError as e:
        click.echo(f"Error: {e}", err=True)
        ctx.exit(1)
        return

    async def _run_recovery():
        from mediasentinel.agents.recovery_engine import RecoveryEngine
        from mediasentinel.db.connection import init_db

        db_path = Path(os.path.expandvars(config.database.db_path))
        await init_db(db_path)

        engine = RecoveryEngine(config, db_path)
        if service_name:
            click.echo(f"Attempting recovery for {service_name}...")
            result = await engine.attempt_recovery(service_name)
        else:
            click.echo("Attempting recovery for all unhealthy services...")
            from mediasentinel.db.connection import get_db

            async with get_db(db_path) as db:
                cursor = await db.execute(
                    "SELECT name FROM services WHERE status = 'unhealthy'"
                )
                rows = await cursor.fetchall()

            if not rows:
                click.echo("No unhealthy services found.")
                return

            for row in rows:
                click.echo(f"  Recovering {row['name']}...")
                result = await engine.attempt_recovery(row["name"])
                if result:
                    status = "OK" if result.success else "FAILED"
                    click.echo(f"    {status}: {result.details}")
                else:
                    click.echo(f"    SKIPPED: on cooldown")

    asyncio.run(_run_recovery())


@cli.command()
@click.pass_context
def config_cmd(ctx):
    try:
        cfg = load_config(Path(ctx.obj["config_path"]))
    except ConfigLoadError as e:
        click.echo(f"Error: {e}", err=True)
        ctx.exit(1)
        return

    click.echo("Configuration valid")
    click.echo(f"  Services: {len(cfg.services)}")
    click.echo(f"  Log directory: {cfg.logging.log_dir}")
    click.echo(f"  Database: {cfg.database.db_path}")


# Register 'config' as alias since config_cmd is the actual function
cli.add_command(config_cmd, name="config")


@cli.command()
@click.pass_context
def tui(ctx):
    from mediasentinel.tui.app import MediaSentinelApp

    app = MediaSentinelApp(config_path=ctx.obj["config_path"])
    app.run()


@cli.command()
@click.pass_context
def validate(ctx):
    from mediasentinel.core.startup import run_startup_checks

    try:
        config = load_config(Path(ctx.obj["config_path"]))
    except ConfigLoadError as e:
        click.echo(f"Configuration error: {e}", err=True)
        ctx.exit(1)
        return

    click.echo("Configuration: OK")
    click.echo(f"  Services: {len(config.services)}")
    click.echo(f"  VPN: {config.vpn.adapter_description}")
    click.echo(f"  Database: {config.database.db_path}")

    db_path = Path(os.path.expandvars(config.database.db_path))

    async def _run_checks():
        return await run_startup_checks(config, db_path)

    results = asyncio.run(_run_checks())
    all_passed = True
    for r in results:
        status = "OK" if r.passed else "FAIL"
        click.echo(f"  [{status}] {r.name}")
        if not r.passed and r.message:
            click.echo(f"         {r.message}")
        if not r.passed:
            all_passed = False

    if all_passed:
        click.echo("All startup checks passed.")
    else:
        click.echo("Some checks failed — review above.", err=True)
        ctx.exit(1)


if __name__ == "__main__":
    cli()
