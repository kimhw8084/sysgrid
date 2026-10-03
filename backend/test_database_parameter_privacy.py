"""Bound values must stay out of SQL diagnostics, including failure paths."""
import logging

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.database import build_engine


@pytest.mark.asyncio
async def test_database_parameters_are_hidden_in_logs_and_exceptions(caplog):
    engine = build_engine('sqlite+aiosqlite:///:memory:')
    sensitive_value = 'SYNTHETIC-PARAMETER-MUST-NOT-BE-LOGGED'
    caplog.set_level(logging.INFO, logger='sqlalchemy.engine')
    try:
        async with engine.begin() as connection:
            await connection.execute(text('CREATE TABLE private_values (value TEXT UNIQUE)'))
            await connection.execute(text('INSERT INTO private_values (value) VALUES (:value)'), {'value': sensitive_value})
            with pytest.raises(IntegrityError) as error:
                await connection.execute(text('INSERT INTO private_values (value) VALUES (:value)'), {'value': sensitive_value})
        assert sensitive_value not in str(error.value)
        assert sensitive_value not in caplog.text
        assert 'INSERT INTO private_values' in caplog.text
        assert 'UNIQUE constraint failed' in str(error.value)
    finally:
        await engine.dispose()
