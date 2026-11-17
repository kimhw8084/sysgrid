#!/usr/bin/env python3
"""Run CLI or read-only MCP with Python standard library only."""
import sys
from golden_uiux.cli import main as cli
from golden_uiux.mcp import main as mcp
if __name__ == '__main__':
    sys.exit(mcp() if len(sys.argv)>=2 and sys.argv[1]=='mcp' else cli())
