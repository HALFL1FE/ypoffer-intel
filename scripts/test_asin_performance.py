from contextlib import nullcontext
from pathlib import Path
import sys
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import offer_db


ASIN = "B000000001"


def test_normalize_asin_query():
    assert offer_db.normalize_asin_query("b000000001, B000000001 B000000002") == [
        "B000000001",
        "B000000002",
    ]
    try:
        offer_db.normalize_asin_query("not-an-asin")
    except ValueError as error:
        assert "valid Amazon ASINs" in str(error)
    else:
        raise AssertionError("invalid ASIN should be rejected")


def test_asin_metric_rows_uses_click_table_fallback_and_derives_metrics():
    order_columns = {
        "asin",
        "advert_id",
        "order_time_day",
        "total_purchases",
        "amount",
        "payout",
        "aff_payout",
        "total_clicks",
        "detail_page_views",
        "add_to_carts",
    }
    click_columns = {"asin", "advert_id", "time_day", "click"}

    def fake_columns(_conn, table):
        return order_columns if table == "cnpscy_amazon_order" else click_columns

    def fake_fetch(_conn, sql, _params):
        if "cnpscy_amazon_order" in sql:
            return [{
                "asin": ASIN,
                "merchantId": "1001",
                "month": "202608",
                "orders": 2,
                "revenue": 160,
                "payout": 20,
                "affiliatePayout": 16,
                "clicks": 0,
                "dpv": 40,
                "atc": 8,
                "directSales": 0,
                "haloSales": 0,
            }]
        return [{
            "asin": ASIN,
            "merchantId": "1001",
            "month": "202608",
            "rawClicks": 20,
        }]

    with patch.object(offer_db, "table_columns", side_effect=fake_columns), patch.object(
        offer_db, "fetch_all", side_effect=fake_fetch
    ):
        rows = offer_db.asin_metric_rows(object(), [ASIN], months=12)

    row = rows[(ASIN, "1001")][0]
    assert row["month"] == "2026-08"
    assert row["clicks"] == 20
    assert row["orders"] == 2
    assert row["salesAmount"] == 160
    assert row["affCommission"] == 16
    assert row["epc"] == 0.8
    assert row["aov"] == 80
    assert row["conversionRate"] == 0.1


def test_asin_payload_combines_product_fields_with_monthly_metrics():
    offer_db._asin_cache.clear()
    monthly = {
        (ASIN, "1001"): [{
            "asin": ASIN,
            "merchantId": "1001",
            "month": "2026-08",
            "clicks": 20,
            "orders": 2,
            "revenue": 160,
            "payout": 20,
            "affiliatePayout": 16,
            "salesAmount": 160,
            "affCommission": 16,
            "epc": 0.8,
            "aov": 80,
            "conversionRate": 0.1,
            "dpv": 40,
            "atc": 8,
        }]
    }
    products = [{
        "asin": ASIN,
        "merchantId": "1001",
        "productName": "Alpha headphones",
        "dealPrice": 79.99,
    }]
    with patch.object(offer_db, "db_connection", return_value=nullcontext(object())), patch.object(
        offer_db, "asin_product_rows", return_value=products
    ), patch.object(offer_db, "asin_metric_rows", return_value=monthly), patch.object(
        offer_db, "asin_merchant_names", return_value={"1001": "Alpha Audio"}
    ):
        payload = offer_db.asin_payload(ASIN, months=12)

    assert payload["available"] is True
    assert payload["unmatched"] == []
    assert payload["grain"] == "asin + merchant + month"
    assert payload["rows"] == [{
        "asin": ASIN,
        "merchantId": "1001",
        "merchantName": "Alpha Audio",
        "productName": "Alpha headphones",
        "dealPrice": 79.99,
        "matchedAsins": [ASIN],
        "monthly": monthly[(ASIN, "1001")],
        "asinPerformanceAvailable": True,
        "orders": 2,
        "revenue": 160,
        "payout": 20,
        "affiliatePayout": 16,
        "clicks": 20,
        "dpv": 40,
        "atc": 8,
        "directSales": 0,
        "haloSales": 0,
        "salesAmount": 160,
        "allCommission": 20,
        "affCommission": 16,
        "allEpc": 1,
        "affEpc": 0.8,
        "epc": 0.8,
        "aov": 80,
        "conversionRate": 0.1,
    }]


if __name__ == "__main__":
    test_normalize_asin_query()
    test_asin_metric_rows_uses_click_table_fallback_and_derives_metrics()
    test_asin_payload_combines_product_fields_with_monthly_metrics()
    print("ASIN performance checks passed")
