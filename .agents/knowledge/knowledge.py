"""Entry script of the knowledge drop-in: the launchers in ``_scripts/`` run this file with the private Python.

It puts its own folder on ``sys.path`` so that ``project_knowledge`` is importable, then hands over to the command line.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from project_knowledge.cli import main

if __name__ == "__main__":
    sys.exit(main())
