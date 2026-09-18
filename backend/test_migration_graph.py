from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


def _script_directory() -> ScriptDirectory:
    config = Config(str(Path(__file__).with_name("alembic.ini")))
    return ScriptDirectory.from_config(config)


def test_migration_graph_has_one_actionable_head() -> None:
    heads = _script_directory().get_heads()

    assert len(heads) == 1, (
        "Alembic migration graph must have exactly one head; found "
        f"{len(heads)} active heads: {', '.join(heads) or '(none)'}. "
        "Add one merge-only revision with every legitimate active head in down_revision."
    )
