"""역할 기반 접근 제어(RBAC) 검사."""

from dataclasses import dataclass, field

ROLE_PERMISSIONS: dict[str, set[str]] = {
    "admin": {"read", "write", "delete", "manage_users"},
    "editor": {"read", "write"},
    "viewer": {"read"},
}


@dataclass
class User:
    name: str
    roles: list[str] = field(default_factory=list)


def check_permission(user: User, action: str) -> bool:
    """사용자의 역할 중 하나라도 해당 권한을 가지면 True.

    알 수 없는 역할은 무시한다. 기본 거부 정책이다.
    """
    for role in user.roles:
        if action in ROLE_PERMISSIONS.get(role, set()):
            return True
    return False


def list_permissions(user: User) -> set[str]:
    out: set[str] = set()
    for role in user.roles:
        out |= ROLE_PERMISSIONS.get(role, set())
    return out
