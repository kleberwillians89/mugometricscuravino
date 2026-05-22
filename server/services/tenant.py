import os
from typing import Optional, Dict, Any, List

from fastapi import HTTPException

from .auth import get_user_id_from_bearer
from .ig_supabase import sb_get_client_id_for_user, sb_get_client_memberships, sb_get_connection_for_client
from .single_tenant import get_known_single_tenant_client_ids


def _is_true(value: str) -> bool:
    return (value or "").strip().lower() in {"1", "true", "yes", "on"}


def _can_bypass_single_tenant_membership_in_dev(requested_client_id: Optional[str]) -> bool:
    if not _is_true(os.getenv("ALLOW_NO_AUTH", "")):
        return False

    requested = (requested_client_id or "").strip()
    if not requested:
        return False

    return requested in get_known_single_tenant_client_ids()


def _local_dev_user_id() -> str:
    return (os.getenv("DEV_USER_ID") or "").strip() or "local-dev-user"


async def require_user_id(authorization: Optional[str]) -> str:
    user_id = await get_user_id_from_bearer(authorization)
    if user_id:
        return user_id

    # Modo local/dev: permite usar API sem JWT
    if _is_true(os.getenv("ALLOW_NO_AUTH", "")):
        dev_user_id = _local_dev_user_id()
        print(
            "[tenant][auth_bypass] "
            f"allow_no_auth=1 reason=missing_or_invalid_bearer user_id={dev_user_id}"
        )
        return dev_user_id

    if not user_id:
        raise HTTPException(status_code=401, detail="Autenticação obrigatória")
    return user_id


async def resolve_client_id(client_id: Optional[str], authorization: Optional[str]) -> str:
    """
    Resolve tenant do request usando somente membership.
    Sem fallback de DEFAULT_CLIENT_ID.
    """
    user_id = await require_user_id(authorization)
    requested = (client_id or "").strip() or "-"
    if _can_bypass_single_tenant_membership_in_dev(client_id):
        resolved_client_id = (client_id or "").strip()
        print(
            f"[tenant] dev_bypass user_id={user_id} requested_client_id={requested} "
            f"resolved_client_id={resolved_client_id} source=allow_no_auth_single_tenant"
        )
        return resolved_client_id
    try:
        resolved = await sb_get_client_id_for_user(user_id, requested_client_id=client_id)
        source = "explicit" if (client_id or "").strip() else "default_single_membership"
        print(
            f"[tenant] user_id={user_id} requested_client_id={requested} "
            f"resolved_client_id={resolved} source={source}"
        )
        return resolved
    except PermissionError as exc:
        if _can_bypass_single_tenant_membership_in_dev(client_id):
            resolved_client_id = (client_id or "").strip()
            print(
                f"[tenant] dev_bypass user_id={user_id} requested_client_id={requested} "
                f"resolved_client_id={resolved_client_id} source=allow_no_auth_single_tenant"
            )
            return resolved_client_id
        print(f"[tenant] denied user_id={user_id} requested_client_id={requested}")
        raise HTTPException(status_code=403, detail=str(exc)) from exc


async def list_memberships_from_auth(authorization: Optional[str]) -> List[Dict[str, Any]]:
    user_id = await require_user_id(authorization)
    return await sb_get_client_memberships(user_id)


async def resolve_connection_id(
    connection_id: Optional[str],
    *,
    client_id: str,
    authorization: Optional[str],
) -> Optional[str]:
    requested = (connection_id or "").strip()
    cid = (client_id or "").strip()
    if not requested:
        print(
            f"[tenant][connection] user_id={await require_user_id(authorization)} "
            f"client_id={cid or '-'} requested_connection_id=- resolved_connection_id=- source=none"
        )
        return None
    if not cid:
        raise HTTPException(status_code=400, detail="client_id é obrigatório para validar connection_id.")

    user_id = await require_user_id(authorization)
    row = await sb_get_connection_for_client(cid, requested)
    if not row:
        print(
            f"[tenant][connection] denied user_id={user_id} client_id={cid} "
            f"requested_connection_id={requested} reason=connection_not_in_client_scope"
        )
        raise HTTPException(
            status_code=403,
            detail="connection_id não pertence ao client_id autenticado.",
        )

    resolved = str(row.get("id") or "").strip()
    print(
        f"[tenant][connection] user_id={user_id} client_id={cid} "
        f"requested_connection_id={requested} resolved_connection_id={resolved or '-'} source=explicit"
    )
    return resolved or None
