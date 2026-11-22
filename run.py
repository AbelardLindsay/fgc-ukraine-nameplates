#!/usr/bin/env python3
import argparse
import uvicorn

parser = argparse.ArgumentParser()
parser.add_argument("--host", default="0.0.0.0")
parser.add_argument("--port", type=int, default=8000)
args = parser.parse_args()

uvicorn.run("main:app", host=args.host, port=args.port)
