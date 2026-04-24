from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import List

from dotenv import load_dotenv


@lru_cache(maxsize=1)
def ensure_env_loaded() -> List[str]:
    """
    Carrega variáveis de ambiente de forma robusta, independente do cwd.

    Ordem de precedência:
    1) server/.env
    2) .env na raiz do projeto (fallback)
    """
    server_dir = Path(__file__).resolve().parents[1]
    project_root_dir = server_dir.parent

    candidates = [
        server_dir / ".env",
        project_root_dir / ".env",
    ]

    loaded_paths: List[str] = []
    for index, env_path in enumerate(candidates):
        if not env_path.exists():
            continue
        # server/.env deve ganhar em ambiente local para evitar segredo antigo no shell.
        load_dotenv(env_path, override=(index == 0))
        loaded_paths.append(str(env_path))

    if loaded_paths:
        print(f"[env] dotenv files loaded: {', '.join(loaded_paths)}")
    else:
        print("[env] dotenv files loaded: none")

    return loaded_paths
