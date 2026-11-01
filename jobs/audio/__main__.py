"""python -m jobs.audio --job <id> | --local <folder> [--clap] | --selftest [--clap] | --describe

Every failure prints one line, `fail: <reason>`, from a fixed list, and exits 1: nothing a library or a
server says (which could hold an address, a key or a hash) reaches the public log.
"""

import argparse
import json
import os
import sys

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")


def describe():
    """What the node tests compare with shared/contract/listen.ts."""
    from . import NAME, VERSION, clap, projection
    from .moods import MOODS

    return {
        "analyzer": {"name": NAME, "version": VERSION},
        "moods": list(MOODS),
        "clap": {"id": clap.MODEL, "revision": clap.REVISION},
        "projection_sha256": projection.SHA256,
    }


def main(argv):
    p = argparse.ArgumentParser(prog="python -m jobs.audio")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--job", metavar="JOB_ID")
    g.add_argument("--local", metavar="FOLDER")
    g.add_argument("--selftest", action="store_true")
    g.add_argument("--describe", action="store_true")
    p.add_argument("--clap", action="store_true", help="also run the CLAP model (downloads it once)")
    a = p.parse_args(argv)
    from .net import Failed
    from .run import run_job, run_local, selftest

    try:
        if a.describe:
            print(json.dumps(describe()))
        elif a.selftest:
            if not selftest(a.clap):
                print("fail: selftest", flush=True)
                return 1
        elif a.local:
            run_local(a.local, a.clap)
        else:
            run_job(a.job)
        return 0
    except Failed as e:
        print(f"fail: {e.reason}", flush=True)
    except BaseException:  # noqa: BLE001 - its words may hold what the log must not
        print("fail: internal", flush=True)
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
