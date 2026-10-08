"""Read-only, bounded projections over the existing Offer Intelligence services."""
from __future__ import annotations

import datetime as dt
import math
import re

import offer_db as db

TIERS = ["Tier 1", "Tier 2", "Tier 3", "Tier 4", "BLACK TIER"]
MERCHANT_FIELDS = ["merchantId", "merchantName", "network", "status", "commissionRate", "paymentCycle", "updatedAt"]
PRODUCT_FIELDS = ["asin", "productName", "price", "category", "subCategory", "bsr", "commissionRate", "updatedAt"]
METRIC_FIELDS = ["month", "orders", "revenue", "payout", "affiliatePayout", "clicks", "dpv", "atc", "directSales", "haloSales", "aov", "epc", "conversionRate"]
OFFER_FIELDS = ["merchantId", "merchantName", "tier", "network", "brand", "category", "sheetCategory", "mainCategory", "commissionRate", "allCommissionRate", "affCommissionRate", "aovType", "visualStatusColor", "paymentCycle"]
TIER_FIELDS = ["Merchant ID", "Merchant Name", "Brand", "Network", "Category", "COUNTRY", "ALL Commission", "AFF Commission", "Order count", "Revenue", "EPC(All)", "EPC(Aff)", "AOV", "AOV Type", "AOV Currency", "AOV Source Date", "Conversion Rate", "Clicks", "DPV", "ATC", "Payout", "Affiliate Payout", "Color"]


def string(max_length=120, **extra):
    return {"type": "string", "minLength": 1, "maxLength": max_length, **extra}


def integer(default, maximum):
    return {"type": "integer", "minimum": 1, "maximum": maximum, "default": default}


MONTH = string(7, pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")
PAGE = {"limit": integer(20, 100), "offset": {"type": "integer", "minimum": 0, "maximum": 100000, "default": 0}}


def tool(name, description, page, properties, required=()):
    return {"name": name, "description": description, "inputSchema": {
        "type": "object", "properties": properties, "required": list(required), "additionalProperties": False,
    }, "annotations": {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}, "_page": page}


TOOLS = [
    tool("search_merchants", "Search published merchants by name or ID. Returns at most limit matches; not an exhaustive paginated search.", "dashboard", {"query": string(120, minLength=2), "limit": integer(20, 50)}, ["query"]),
    tool("get_merchant", "Read one published merchant and bounded product/monthly metrics. minimal=true skips product and profile queries for faster trend-only retrieval.", "dashboard", {"merchantId": string(32, pattern=r"^[0-9]+$"), "months": integer(6, 24), "productLimit": integer(10, 50), "minimal": {"type": "boolean", "default": False}}, ["merchantId"]),
    tool("get_asin_details", "Read up to 25 ASINs in one call. Only published merchants are visible; missing ASINs are reported as unmatched. Monetary values retain source units.", "dashboard", {"asins": {"type": "array", "minItems": 1, "maxItems": 25, "uniqueItems": True, "items": string(10, pattern=r"^[Bb][0-9A-Za-z]{9}$")}, "months": integer(6, 24), **PAGE}, ["asins"]),
    tool("search_offers", "Search the current cached Offer catalogue by merchant name/ID, category, network and tier. Metadata only; use get_tier_report for dated performance. Filters precede pagination; optional fields reduce output.", "dashboard", {"query": string(), "category": string(), "network": string(), "tier": string(enum=TIERS), "fields": {"type": "array", "minItems": 1, "maxItems": len(OFFER_FIELDS), "uniqueItems": True, "items": string(enum=OFFER_FIELDS)}, **PAGE}),
    tool("get_tier_report", "Read one Tier report for a month. Filter category/name and sort before pagination. EPC is affiliate EPC; commission columns are percent points, conversion is a ratio. AOV Type distinguishes actual from estimated. Source monetary units are preserved.", "tier", {"tier": string(enum=TIERS), "month": MONTH, "query": string(), "category": string(), "sortBy": string(enum=["merchantId", "revenue", "orders", "epc", "aov"]), "descending": {"type": "boolean", "default": True}, **PAGE}, ["tier"]),
    tool("get_data_status", "Read source freshness dates and snapshot timestamp. checkedAt is when the source was checked, not when underlying records changed.", "dashboard", {}),
]
BY_NAME = {item["name"]: item for item in TOOLS}


def validate(value, schema, path="arguments"):
    kind = schema["type"]
    valid = {"object": lambda: isinstance(value, dict), "array": lambda: isinstance(value, list), "string": lambda: isinstance(value, str), "integer": lambda: type(value) is int, "boolean": lambda: type(value) is bool}[kind]()
    if not valid:
        raise ValueError(f"{path}: expected {kind}")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"{path}: unsupported value")
    if kind == "object":
        props = schema["properties"]
        if set(value) - set(props) or set(schema.get("required", [])) - set(value):
            raise ValueError(f"{path}: unknown or missing fields")
        for key, item in value.items():
            validate(item, props[key], f"{path}.{key}")
    elif kind == "array":
        if not schema.get("minItems", 0) <= len(value) <= schema["maxItems"]:
            raise ValueError(f"{path}: invalid item count")
        for item in value:
            validate(item, schema["items"], path)
        if schema.get("uniqueItems") and len(set(value)) != len(value):
            raise ValueError(f"{path}: duplicate items")
    elif kind == "string":
        if not schema.get("minLength", 0) <= len(value) <= schema["maxLength"] or not value.strip():
            raise ValueError(f"{path}: invalid length")
        if "pattern" in schema and re.fullmatch(schema["pattern"], value) is None:
            raise ValueError(f"{path}: invalid format")
    elif kind == "integer" and not schema["minimum"] <= value <= schema["maximum"]:
        raise ValueError(f"{path}: outside allowed range")


def project(row, fields):
    return {key: row[key] for key in fields if key in row}


def metadata(payload):
    return {"retrievedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "sourceCheckedAt": payload.get("checkedAt"), "sourceGeneratedAt": payload.get("generatedAt"), "month": payload.get("month"), "startDate": payload.get("startDate"), "endDate": payload.get("endDate"), "cachePolicy": "Existing service cache; sourceCheckedAt is not a guarantee of live data", "timezone": "Asia/Shanghai"}


def paginate(rows, args):
    offset, limit = args.get("offset", 0), args.get("limit", 20)
    end = offset + limit
    return {"rows": rows[offset:end], "total": len(rows), "offset": offset, "limit": limit, "nextOffset": end if end < len(rows) else None}


def matches(row, args, tier=False):
    name, mid = ("Merchant Name", "Merchant ID") if tier else ("merchantName", "merchantId")
    query = args.get("query", "").strip().casefold()
    if query and query not in f"{row.get(name, '')} {row.get(mid, '')}".casefold():
        return False
    category = row.get("Category") if tier else (row.get("sheetCategory") or row.get("mainCategory") or row.get("category"))
    if "category" in args and str(category or "").casefold() != args["category"].strip().casefold():
        return False
    return all(str(row.get(key, "")).casefold() == args[key].strip().casefold() for key in ("network", "tier") if key in args and not tier)


def execute(name, args):
    """Only this explicit dispatch can reach data functions; no arbitrary SQL/URLs."""
    validate(args, BY_NAME[name]["inputSchema"])
    if "month" in args:
        dt.date.fromisoformat(args["month"] + "-01")
    visible = set(map(str, db.read_static_merchant_ids()))
    if name == "search_merchants":
        payload = db.search_payload(args["query"], limit=200)
        rows = [project(r, MERCHANT_FIELDS) for r in payload["results"] if str(r.get("merchantId")) in visible][:args.get("limit", 20)]
        result = {"rows": rows, "query": args["query"], "exhaustive": False}
    elif name == "get_merchant":
        if args["merchantId"] not in visible:
            raise ValueError("Merchant is unavailable in the published snapshot")
        payload = db.merchant_payload(args["merchantId"], product_limit=args.get("productLimit", 10), months=args.get("months", 6), minimal=args.get("minimal", False))
        result = {"merchantId": args["merchantId"], "merchant": project(payload.get("merchant") or {}, MERCHANT_FIELDS), "products": [project(r, PRODUCT_FIELDS) for r in payload.get("products", [])], "monthlyAmazonMetrics": [project(r, METRIC_FIELDS) for r in payload.get("monthlyAmazonMetrics", [])], "monthlyAggregateMetrics": [project(r, METRIC_FIELDS) for r in payload.get("monthlyAggregateMetrics", [])]}
    elif name == "get_asin_details":
        payload = db.asin_payload(args["asins"], months=args.get("months", 6))
        rows = []
        for row in payload["rows"]:
            if str(row.get("merchantId")) not in visible:
                continue
            safe = project(row, PRODUCT_FIELDS + MERCHANT_FIELDS + METRIC_FIELDS + ["asinPerformanceAvailable"])
            safe["monthly"] = [project(r, METRIC_FIELDS) for r in row.get("monthly", [])]
            rows.append(safe)
        matched = {r["asin"] for r in rows}
        result = {**paginate(rows, args), "unmatched": [a.upper() for a in args["asins"] if a.upper() not in matched]}
    elif name == "search_offers":
        payload = db.offers_payload()
        rows = [r for r in payload["offers"] if str(r.get("merchantId")) in visible and matches(r, args)]
        rows.sort(key=lambda r: (str(r.get("merchantId", "")), str(r.get("network", ""))))
        result = paginate(rows, args)
        result["rows"] = [project(r, args.get("fields", OFFER_FIELDS)) for r in result["rows"]]
    elif name == "get_tier_report":
        payload = db.tier_sheet_payload(args["tier"], month=args.get("month"))
        rows = [project(r, TIER_FIELDS) for r in payload["rows"] if str(r.get("Merchant ID")) in visible and matches(r, args, tier=True)]
        field = {"merchantId": "Merchant ID", "revenue": "Revenue", "orders": "Order count", "epc": "EPC(Aff)", "aov": "AOV"}[args.get("sortBy", "revenue")]
        def number(row):
            try:
                value = float(row.get(field) or 0)
                return value if math.isfinite(value) else 0
            except (ValueError, TypeError):
                return 0
        rows.sort(key=lambda r: str(r.get("Merchant ID", "")))
        rows.sort(key=number, reverse=args.get("descending", True))
        result = {**paginate(rows, args), "tier": args["tier"]}
    else:  # get_data_status
        payload = db.status_payload()
        result = {"latestDates": payload.get("latestDates", {}), "staticSnapshot": project(payload.get("staticSnapshot", {}), ["generatedAt", "merchantIds"])}
    return {"ok": True, **result, "metadata": metadata(payload)}
