"""Optional official Python MCP SDK interop test with synthetic data only."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys
import threading
from unittest.mock import patch
from wsgiref.simple_server import make_server, WSGIRequestHandler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import anyio
import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from api.db.index import app
import auth
import mcp_tools

TOKEN = 'synthetic-sdk-credential-' + 'x' * 40
ENTRY = {'id': 'sdk-test', 'sha256': hashlib.sha256(TOKEN.encode()).hexdigest(), 'username': 'sdk-reader', 'tools': list(mcp_tools.BY_NAME), 'expiresAt': '2099-01-01T00:00:00Z'}


class QuietHandler(WSGIRequestHandler):
    def log_message(self, *args):
        pass


def routed_app(environ, start_response):
    environ['HTTP_X_OI_DB_ROUTE'] = 'mcp'
    return app(environ, start_response)


async def exercise(url):
    async with httpx2.AsyncClient(trust_env=False, headers={'Authorization': 'Bearer ' + TOKEN}) as http:
        async with streamable_http_client(url, http_client=http) as (read, write):
            async with ClientSession(read, write) as client:
                init = await client.initialize()
                assert init.server_info.name == 'yeahpromos-offer-intelligence'
                tools = await client.list_tools()
                assert len(tools.tools) == 6
                await client.send_ping()
                result = await client.call_tool('get_data_status', {})
                assert not result.is_error
                assert json.loads(result.content[0].text)['latestDates']['amazonClicks'] == '2026-09-30'
                result = await client.call_tool('get_merchant', {'merchantId': '999'})
                assert result.is_error


def main():
    with patch.dict(os.environ, {'OI_MCP_CREDENTIALS': json.dumps([ENTRY])}), patch.object(auth, 'user_record_by_username', return_value={'username': 'sdk-reader', 'level': 1, 'is_active': 1}), patch.object(mcp_tools.db, 'read_static_merchant_ids', return_value=['42']), patch.object(mcp_tools.db, 'status_payload', return_value={'latestDates': {'amazonClicks': '2026-09-30'}}):
        server = make_server('127.0.0.1', 0, routed_app, handler_class=QuietHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            anyio.run(exercise, f'http://127.0.0.1:{server.server_port}/mcp')
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)
    print('Official MCP SDK interoperability passed; SDK version:', importlib.metadata.version('mcp'))


if __name__ == '__main__':
    main()
