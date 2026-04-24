from __future__ import annotations

import os


def _env(name: str) -> str:
    return (os.getenv(name) or "").strip()


def get_roove_client_id() -> str:
    client_id = _env("ROOVE_CLIENT_ID")
    if client_id:
        return client_id

    compat_client_id = _env("DEFAULT_CLIENT_ID")
    if compat_client_id:
        print("[single_tenant] compat=DEFAULT_CLIENT_ID used for Roove client resolution")
        return compat_client_id

    raise RuntimeError("ROOVE_CLIENT_ID não configurado para o backend single-tenant.")


def get_roove_shopify_domain() -> str:
    return _env("SHOPIFY_ROOVE_SHOP_DOMAIN").lower()


def get_roove_ga4_property_id() -> str:
    for env_name in ("GA4_PROPERTY_ID", "ROOVE_GA4_PROPERTY_ID"):
        value = _env(env_name)
        if value:
            if value.startswith("properties/"):
                return value.split("/", 1)[1].strip()
            return value

    raise RuntimeError("GA4_PROPERTY_ID não configurado para o backend single-tenant.")
