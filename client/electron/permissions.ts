const trustedRendererPermissions = new Set<string>(["media", "display-capture", "fullscreen"]);

export function isAllowedRendererPermission(permission: string): boolean {
  return trustedRendererPermissions.has(permission);
}
