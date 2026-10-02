"""Bound import admission before multipart/JSON decoding and domain work."""
from fastapi import HTTPException
from starlette.responses import JSONResponse

from .api.operational_bulk import MAX_OPERATIONAL_BULK_RECORDS

MAX_IMPORT_FILE_BYTES = 10 * 1024 ** 2
MAX_IMPORT_REQUEST_BYTES = 12 * 1024 ** 2
MAX_IMPORT_WORKBOOK_BYTES = 64 * 1024 ** 2
MAX_IMPORT_WORKBOOK_ENTRIES = 4096
IMPORT_LIMITS = {'max_file_bytes': MAX_IMPORT_FILE_BYTES, 'max_request_bytes': MAX_IMPORT_REQUEST_BYTES,
                 'max_rows': MAX_OPERATIONAL_BULK_RECORDS}
IMPORT_WRITE_PATHS = frozenset(f'/api/v1/import/{path}' for path in ('preview-file', 'preview-rows', 'execute', 'audit'))


def require_import_row_limit(rows):
    if len(rows) > MAX_OPERATIONAL_BULK_RECORDS:
        raise HTTPException(413, f'Imports are limited to {MAX_OPERATIONAL_BULK_RECORDS} rows. Split the data into smaller batches.')


class ImportRequestLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http' or scope['method'] != 'POST' or scope['path'] not in IMPORT_WRITE_PATHS:
            return await self.app(scope, receive, send)

        async def reject():
            return await JSONResponse(status_code=413, content={
                'code': 'IMPORT_REQUEST_TOO_LARGE',
                'detail': 'Import request exceeds 12 MiB. Split the data into smaller batches.',
            })(scope, receive, send)

        for key, value in scope.get('headers', []):
            if key.lower() == b'content-length':
                try:
                    if int(value) > MAX_IMPORT_REQUEST_BYTES:
                        return await reject()
                except ValueError:
                    pass  # Actual received bytes remain authoritative.

        # One bounded buffer avoids unbounded per-chunk bookkeeping. Admission
        # finishes before downstream JSON/multipart parsing or any mutation.
        body = bytearray()
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            chunk = message.get('body', b'')
            if len(body) + len(chunk) > MAX_IMPORT_REQUEST_BYTES:
                return await reject()
            body.extend(chunk)
            if not message.get('more_body', False):
                break

        async def replay():
            nonlocal body
            if body is not None:
                payload = bytes(body)
                body = None
                return {'type': 'http.request', 'body': payload, 'more_body': False}
            return await receive()

        await self.app(scope, replay, send)
