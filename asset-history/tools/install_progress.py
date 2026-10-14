#!/usr/bin/env python3
"""Report completed installation steps and a heartbeat, never estimated build progress."""
import argparse
import os
import sys
import time

BAR_WIDTH = 24
SPINNER = ("|", "/", "-", "\\")


def format_duration(seconds):
    seconds = max(0, int(seconds))
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}"


def render_progress(completed, total, label, elapsed, overall_elapsed, active=True, tick=0):
    if not isinstance(total, int) or not 1 <= total <= 100:
        raise ValueError("Total steps must be between 1 and 100.")
    if not isinstance(completed, int) or not 0 <= completed <= total:
        raise ValueError("Completed steps must be within the total.")
    filled = completed * BAR_WIDTH // total
    percent = completed * 100 // total
    indicator = SPINNER[tick % len(SPINNER)] if active else "OK"
    status = "Running" if active else "Done"
    return (f"{indicator} [{'=' * filled}{'-' * (BAR_WIDTH - filled)}] {percent:3d}% "
            f"({completed}/{total} steps complete) | {status}: {label} | "
            f"step {format_duration(elapsed)}, total {format_duration(overall_elapsed)}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--completed", type=int, required=True)
    parser.add_argument("--total", type=int, required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--elapsed", type=int, default=0)
    parser.add_argument("--overall-elapsed", type=int, default=0)
    parser.add_argument("--done", action="store_true")
    parser.add_argument("--watch", action="store_true")
    parser.add_argument("--parent", type=int)
    parser.add_argument("--interval", type=float, default=10)
    args = parser.parse_args(argv)
    if args.watch and (args.parent is None or args.parent <= 0):
        parser.error("--watch requires the installation process ID")
    if not 0.05 <= args.interval <= 60:
        parser.error("--interval must be between 0.05 and 60 seconds")
    if args.elapsed < 0 or args.overall_elapsed < 0:
        parser.error("Elapsed times must be nonnegative")
    try:
        render_progress(args.completed, args.total, args.label, 0, 0)
    except ValueError as error:
        parser.error(str(error))
    started = time.monotonic()
    tick = 0
    try:
        if not args.watch:
            print(render_progress(args.completed, args.total, args.label, args.elapsed,
                                  args.overall_elapsed, active=not args.done), flush=True)
            return 0
        while True:
            time.sleep(args.interval)
            # On Linux an orphan is reparented. A watch must stop when its
            # installer disappears. Windows Bash uses translated process IDs;
            # explicit shell cleanup handles the local Windows tests instead.
            if os.name != "nt" and os.getppid() != args.parent:
                return 0
            tick += 1
            age = int(time.monotonic() - started)
            print(render_progress(args.completed, args.total, args.label,
                                  args.elapsed + age, args.overall_elapsed + age,
                                  active=True, tick=tick), flush=True)
    except BrokenPipeError:
        return 0
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
