"""Protocol, authorization, data boundaries and both runtime adapters; no live DB."""
import hashlib
from io import BytesIO
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import auth
from api.db.index import app
import mcp_http
import mcp_tools

TOKEN = 'test-only-not-a-production-secret-' + 'a' * 32
ENTRY = {'id': 'test', 'sha256': hashlib.sha256(TOKEN.encode()).hexdigest(), 'username': 'reader', 'tools': list(mcp_tools.BY_NAME), 'expiresAt': '2099-01-01T00:00:00Z'}
USER = {'username': 'reader', 'is_active': 1, 'level': 1}


class McpTests(unittest.TestCase):
    def setUp(self):
        for ctx in [patch.dict(os.environ, {'OI_MCP_CREDENTIALS': json.dumps([ENTRY]), 'OI_AUTH_ENABLED': '0'}), patch.object(auth, 'user_record_by_username', return_value=USER), patch.object(mcp_tools.db, 'read_static_merchant_ids', return_value=['42', '43'])]:
            ctx.start()
            self.addCleanup(ctx.stop)

    def request(self, method='tools/list', params=None, token=TOKEN, http='POST', headers=None, raw=None, request_id=1):
        message = {'jsonrpc': '2.0', 'method': method, 'params': params or {}}
        if request_id is not None:
            message['id'] = request_id
        body = raw if raw is not None else json.dumps(message).encode()
        env = {'REQUEST_METHOD': http, 'PATH_INFO': '/api/db/index', 'QUERY_STRING': '', 'HTTP_X_OI_DB_ROUTE': 'mcp', 'CONTENT_TYPE': 'application/json', 'CONTENT_LENGTH': str(len(body)), 'HTTP_ACCEPT': 'application/json, text/event-stream', 'HTTP_MCP_PROTOCOL_VERSION': '2025-11-25', 'wsgi.input': BytesIO(body)}
        if token is not None:
            env['HTTP_AUTHORIZATION'] = 'Bearer ' + token
        env.update(headers or {})
        response = {}
        def start(status, response_headers):
            response['status'] = int(status.split()[0])
            response['headers'] = dict(response_headers)
        content = b''.join(app(env, start))
        response['data'] = json.loads(content) if content else None
        return response

    def call(self, name, args):
        return self.request('tools/call', {'name': name, 'arguments': args})

    def test_initialize_and_notifications(self):
        r = self.request('initialize', {'protocolVersion': '2025-11-25', 'capabilities': {}, 'clientInfo': {'name': 'test', 'version': '1'}})
        self.assertEqual(r['data']['result']['protocolVersion'], '2025-11-25')
        self.assertNotIn('MCP-Session-Id', r['headers'])
        r = self.request('notifications/initialized', request_id=None)
        self.assertEqual((r['status'], r['data']), (202, None))
        self.assertEqual(self.request('ping')['data']['result'], {})

    def test_version_negotiation(self):
        r = self.request('initialize', {'protocolVersion': 'future', 'capabilities': {}, 'clientInfo': {}}, headers={'HTTP_MCP_PROTOCOL_VERSION': ''})
        self.assertEqual(r['data']['result']['protocolVersion'], '2025-11-25')
        self.assertEqual(self.request(headers={'HTTP_MCP_PROTOCOL_VERSION': 'bad'})['status'], 400)

    def test_tools_are_readonly(self):
        tools = self.request()['data']['result']['tools']
        self.assertEqual(len(tools), 6)
        for item in tools:
            self.assertTrue(item['annotations']['readOnlyHint'])
            self.assertNotIn('_page', item)

    def test_no_cookie_or_development_bypass(self):
        self.assertEqual(self.request(token=None, headers={'HTTP_COOKIE': 'oi_session=anything'})['status'], 401)
        self.assertEqual(self.request(token='wrong' * 10)['status'], 401)

    def test_missing_or_malformed_configuration(self):
        for value in ['', '{}', '[]', json.dumps([{**ENTRY, 'tools': ['delete_merchant']}]), json.dumps([{**ENTRY, 'expiresAt': '2099-01-01'}]), json.dumps([ENTRY, ENTRY])]:
            with patch.dict(os.environ, {'OI_MCP_CREDENTIALS': value}):
                self.assertEqual(self.request()['status'], 503)

    def test_expired_or_revoked_credentials(self):
        with patch.dict(os.environ, {'OI_MCP_CREDENTIALS': json.dumps([{**ENTRY, 'expiresAt': '2000-01-01T00:00:00Z'}])}):
            self.assertEqual(self.request()['status'], 401)
        with patch.dict(os.environ, {'OI_MCP_CREDENTIALS': json.dumps([{**ENTRY, 'sha256': '0' * 64}])}):
            self.assertEqual(self.request()['status'], 401)

    def test_live_user_revocation_and_levels(self):
        for user, status in [(None, 401), ({**USER, 'is_active': 0}, 401), ({**USER, 'level': 2}, 403), ({**USER, 'level': 9}, 403), ({**USER, 'level': 0}, 200)]:
            with patch.object(auth, 'user_record_by_username', return_value=user):
                self.assertEqual(self.request()['status'], status)
        with patch.object(auth, 'user_record_by_username', side_effect=RuntimeError('mysql password=secret')):
            r = self.request()
            self.assertEqual(r['status'], 503)
            self.assertNotIn('secret', str(r))

    def test_tool_scopes_and_no_write_dispatch(self):
        with patch.dict(os.environ, {'OI_MCP_CREDENTIALS': json.dumps([{**ENTRY, 'tools': ['get_data_status']}])}):
            self.assertEqual([t['name'] for t in self.request()['data']['result']['tools']], ['get_data_status'])
            with patch.object(mcp_tools, 'execute') as execute:
                self.assertEqual(self.call('get_merchant', {'merchantId': '42'})['data']['error']['code'], -32602)
                execute.assert_not_called()
        for name in ['delete_merchant', 'execute_sql', '__dict__']:
            self.assertIn('error', self.call(name, {})['data'])

    def test_origin_and_transport(self):
        self.assertEqual(self.request(headers={'HTTP_ORIGIN': 'https://evil.example'})['status'], 403)
        self.assertEqual(self.request(headers={'HTTP_ORIGIN': 'null'})['status'], 403)
        self.assertEqual(self.request(headers={'HTTP_ORIGIN': 'https://www.yeahpromo.asia'})['status'], 200)
        for method in ['GET', 'DELETE', 'PUT', 'OPTIONS']:
            self.assertEqual(self.request(http=method)['status'], 405)
        self.assertEqual(self.request(headers={'CONTENT_TYPE': 'text/plain'})['status'], 415)
        self.assertEqual(self.request(headers={'HTTP_ACCEPT': 'application/json'})['status'], 406)
        self.assertEqual(self.request(headers={'CONTENT_LENGTH': str(mcp_http.MAX_BODY + 1)})['status'], 413)
        self.assertEqual(self.request(headers={'CONTENT_LENGTH': 'x'})['status'], 400)

    def test_invalid_rpc(self):
        for raw, code in [(b'{', -32700), (b'[]', -32600), (b'null', -32600), (b'{"jsonrpc":"2.0","id":true,"method":"ping"}', -32600)]:
            self.assertEqual(self.request(raw=raw)['data']['error']['code'], code)
        self.assertEqual(self.request('unknown')['data']['error']['code'], -32601)

    def test_argument_validation_before_database(self):
        with patch.object(mcp_tools, 'execute') as execute:
            for name, args in [('search_merchants', {'query': 'x'}), ('get_merchant', {'merchantId': "42 OR 1=1"}), ('get_merchant', {'merchantId': '42', 'months': True}), ('search_offers', {'limit': 1000}), ('search_offers', {'fields': ['password_hash']}), ('get_tier_report', {'tier': 'all'}), ('get_asin_details', {'asins': ['B123456789'] * 26}), ('get_data_status', {'sql': 'SELECT *'})]:
                self.assertEqual(self.call(name, args)['data']['error']['code'], -32602)
            execute.assert_not_called()

    def test_merchant_scope_and_projection(self):
        with patch.object(mcp_tools.db, 'merchant_payload', return_value={'merchant': {'merchantName': 'Test', 'password': 'hidden'}, 'products': [{'asin': 'B123456789', 'secret': 'hidden'}]}) as lookup:
            self.assertTrue(self.call('get_merchant', {'merchantId': '99'})['data']['result']['isError'])
            lookup.assert_not_called()
            r = self.call('get_merchant', {'merchantId': '42', 'minimal': True})['data']['result']
            self.assertNotIn('hidden', str(r))
            lookup.assert_called_once_with('42', product_limit=10, months=6, minimal=True)

    def test_search_scope(self):
        with patch.object(mcp_tools.db, 'search_payload', return_value={'results': [{'merchantId': '99'}, {'merchantId': '42', 'merchantName': 'Test', 'secret': 'hidden'}]}):
            r = self.call('search_merchants', {'query': 'Test'})['data']['result']['structuredContent']
            self.assertEqual([v['merchantId'] for v in r['rows']], ['42'])
            self.assertNotIn('hidden', str(r))

    def test_asin_batch_scope_and_pagination(self):
        payload = {'rows': [{'asin': 'B123456789', 'merchantId': '99'}, {'asin': 'B123456780', 'merchantId': '42', 'monthly': [{'month': '2026-09', 'revenue': 30, 'secret': 'hidden'}]}]}
        with patch.object(mcp_tools.db, 'asin_payload', return_value=payload):
            r = self.call('get_asin_details', {'asins': ['B123456789', 'B123456780']})['data']['result']['structuredContent']
            self.assertEqual(r['unmatched'], ['B123456789'])
            self.assertEqual(r['total'], 1)
            self.assertNotIn('hidden', str(r))

    def test_offer_filters_before_pagination_and_no_cache_mutation(self):
        rows = [{'merchantId': '42', 'merchantName': 'Test', 'tier': 'Tier 2', 'sheetCategory': 'Beauty', 'network': 'Direct', 'secret': 'hidden'}, {'merchantId': '43', 'tier': 'Tier 1'}]
        original = json.dumps(rows)
        with patch.object(mcp_tools.db, 'offers_payload', return_value={'offers': rows, 'checkedAt': '2026-09-01'}):
            r = self.call('search_offers', {'category': 'beauty', 'tier': 'Tier 2', 'limit': 1, 'fields': ['merchantId']})['data']['result']['structuredContent']
            self.assertEqual(r['rows'], [{'merchantId': '42'}])
            self.assertEqual(r['total'], 1)
            self.assertEqual(r['metadata']['sourceCheckedAt'], '2026-09-01')
            self.assertEqual(json.dumps(rows), original)
            r = self.call('search_offers', {'limit': 1})['data']['result']['structuredContent']
            self.assertEqual(r['nextOffset'], 1)

    def test_tier_numeric_sort_and_dates(self):
        rows = [{'Merchant ID': '42', 'EPC(Aff)': '2', 'Category': 'Beauty'}, {'Merchant ID': '43', 'EPC(Aff)': '10', 'Category': 'Beauty', 'BD': 'private'}]
        with patch.object(mcp_tools.db, 'tier_sheet_payload', return_value={'rows': rows, 'month': '2026-09'}) as lookup:
            r = self.call('get_tier_report', {'tier': 'Tier 2', 'month': '2026-09', 'sortBy': 'epc', 'limit': 1})['data']['result']['structuredContent']
            self.assertEqual(r['rows'][0]['Merchant ID'], '43')
            self.assertNotIn('BD', r['rows'][0])
            lookup.assert_called_once_with('Tier 2', month='2026-09')

    def test_status_and_sanitized_errors(self):
        with patch.object(mcp_tools.db, 'status_payload', return_value={'checkedAt': 'then', 'latestDates': {'amazonClicks': 'yesterday'}, 'coverage': {'internalTable': 42}}):
            r = self.call('get_data_status', {})['data']['result']['structuredContent']
            self.assertEqual(r['metadata']['sourceCheckedAt'], 'then')
            self.assertNotIn('coverage', r)
        with patch.object(mcp_tools.db, 'status_payload', side_effect=RuntimeError('password=secret')):
            r = self.call('get_data_status', {})
            self.assertTrue(r['data']['result']['isError'])
            self.assertNotIn('secret', str(r))

    def test_response_size(self):
        with patch.object(mcp_tools, 'execute', return_value={'large': 'a' * mcp_http.MAX_RESPONSE}):
            self.assertTrue(self.call('get_data_status', {})['data']['result']['isError'])

    def test_audit_does_not_log_arguments_or_token(self):
        with self.assertLogs(mcp_http.LOG, level='INFO') as logs:
            self.call('get_merchant', {'merchantId': '99'})
        text = str(logs.output)
        self.assertIn('credential=test', text)
        self.assertNotIn(TOKEN, text)
        self.assertNotIn('merchantId', text)

    def test_credential_generator(self):
        import subprocess
        generated = subprocess.run([sys.executable, str(ROOT / 'scripts/create_mcp_credential.py'), '--id', 'unit', '--username', 'Reader', '--tool', 'get_data_status'], check=True, capture_output=True, text=True)
        result = json.loads(generated.stdout)
        self.assertEqual(hashlib.sha256(result['bearerToken'].encode()).hexdigest(), result['credential']['sha256'])
        self.assertEqual(result['credential']['username'], 'reader')
        self.assertEqual(result['credential']['tools'], ['get_data_status'])
        self.assertNotIn(result['bearerToken'], generated.stderr)

    def test_vercel_route(self):
        config = json.loads((ROOT / 'vercel.json').read_text())
        routes = [r for r in config['routes'] if r.get('transforms', [{}])[0].get('args') == 'mcp']
        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0]['dest'], '/api/db/index')

    def test_local_adapter_real_http(self):
        # Actual HTTP roundtrip through server.Handler, not just direct dispatch.
        import http.client
        import threading
        from http.server import ThreadingHTTPServer
        from server import Handler
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
            body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'tools/list'})
            connection.request('POST', '/mcp', body, {'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/json, text/event-stream', 'Content-Type': 'application/json'})
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(len(json.loads(response.read())['result']['tools']), 6)
            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == '__main__':
    unittest.main()
