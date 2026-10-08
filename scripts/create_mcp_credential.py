"""Generate an MCP token locally; only the hash/configuration goes to the server."""
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import secrets
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mcp_tools import BY_NAME


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--id', required=True, help='Non-secret credential label')
    parser.add_argument('--username', required=True, help='Existing active level 0/1 application username')
    parser.add_argument('--days', type=int, default=30, help='Validity, 1–365 days (default 30)')
    parser.add_argument('--tool', action='append', choices=sorted(BY_NAME), required=True, help='Allowed tool; repeat for multiple tools')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', args.id) or not 1 <= args.days <= 365 or not args.username.strip() or len(args.username) > 128:
        parser.error('Invalid id, username or validity period')
    token = 'oi_mcp_' + secrets.token_urlsafe(32)
    entry = {'id': args.id, 'username': args.username.strip().casefold(), 'sha256': hashlib.sha256(token.encode()).hexdigest(), 'tools': list(dict.fromkeys(args.tool)), 'expiresAt': (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=args.days)).isoformat()}
    print(json.dumps({'bearerToken': token, 'credential': entry}, indent=2))
    print('Keep bearerToken in your client secret store. Append credential to the OI_MCP_CREDENTIALS JSON array in server deployment settings. Do not commit either output.', file=sys.stderr)


if __name__ == '__main__':
    main()
