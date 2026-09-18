#!/usr/bin/env python3
"""Run Alembic through the invoking Python interpreter."""

from alembic.config import CommandLine


if __name__ == "__main__":
    CommandLine(prog="alembic").main()
