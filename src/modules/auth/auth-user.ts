import type { PrismaClient, RoleName } from "@prisma/client";
import type { PermissionCode } from "../../common/permissions.js";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  roles: RoleName[];
  permissions: PermissionCode[];
}

export async function loadAuthUser(prisma: PrismaClient, userId: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      roles: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      },
    },
  });
  if (!user || !user.isActive) {
    return null;
  }

  const roles = user.roles.map((userRole: { role: { name: RoleName } }) => userRole.role.name);
  const permissions = new Set<PermissionCode>();
  for (const userRole of user.roles) {
    for (const rolePermission of userRole.role.permissions) {
      permissions.add(rolePermission.permission.code as PermissionCode);
    }
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roles,
    permissions: [...permissions],
  };
}
