"""产品关键词查询意图及近似候选词参数。"""

from __future__ import annotations

from skills.base import ExamplePair, IntentSkill, ParamDef


class KeywordSkill(IntentSkill):
    @property
    def intent(self) -> str:
        return "keyword"

    def prompt_intent_section(self) -> str:
        return (
            "- keyword: The user searches for a product type or product keyword and wants matching "
            "merchants, e.g. '查询mobilityscooter' or 'find vacuum cleaner brands'. "
            "Do not classify a product lookup as a general recommendation. "
            "Use merchant only for a named brand or numeric merchant ID. "
            "Keep the original product phrase in keywordSearch; if useful, provide up to three "
            "semantically related search phrases in order of closeness. These are candidates, "
            "never exact matches unless the catalog confirms them.\n"
        )

    def param_schema(self) -> dict[str, ParamDef]:
        return {
            "keywordSearch": ParamDef(type="str", required=True, description="Original product phrase only, without query verbs."),
            "semanticAlternatives": ParamDef(
                type="array",
                description="Up to three related product phrases, nearest first; try only if the original has no matches.",
            ),
        }

    def examples(self) -> list[ExamplePair]:
        return [
            ExamplePair(
                query="查询mobilityscooter",
                output={"intent": "keyword", "params": {
                    "keywordSearch": "mobilityscooter", "semanticAlternatives": ["mobility scooter", "scooter"]
                }},
            ),
            ExamplePair(
                query="扫地机器人相关商家",
                output={"intent": "keyword", "params": {
                    "keywordSearch": "扫地机器人", "semanticAlternatives": ["robot vacuum", "vacuum cleaner"]
                }},
            ),
        ]

    def fallback_keywords(self) -> dict[str, list[str]]:
        return {"en": ["keyword", "product search"], "zh": ["关键词", "产品搜索"]}


keyword_skill = KeywordSkill()
