
import { ViewType, SpaceRole } from '@prisma/client';

const VALID_SPACE_ROLES: readonly string[] = Object.values(SpaceRole);
const VALID_VIEW_TYPES: readonly string[] = Object.values(ViewType);

// убираем HTML-теги и энтити — базовая защита от XSS
function sanitizeText(input: string, maxLength: number): string | null {
  const stripped = input
    .replace(/<[^>]*>/g, '')
    .replace(/&\w+;/g, '')
    .trim();
  if (stripped.length === 0 || stripped.length > maxLength) return null;
  return stripped;
}

export function validateSpaceName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  return sanitizeText(name, 200);
}

export function validateUserId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const t = id.trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(t)) return null;
  return t;
}

export function validateSpaceRole(role: unknown): SpaceRole | null {
  if (typeof role !== 'string') return null;
  if (!VALID_SPACE_ROLES.includes(role)) return null;
  return role as SpaceRole;
}

export function validateFileTitle(title: unknown): string | null {
  if (typeof title !== 'string') return null;
  return sanitizeText(title, 500);
}

export function validateViewType(type: unknown): ViewType | null {
  if (typeof type !== 'string') return null;
  if (!VALID_VIEW_TYPES.includes(type)) return null;
  return type as ViewType;
}

export function validateViewName(name: unknown): string | null {
  if (name === null || name === undefined) return null;
  if (typeof name !== 'string') return null;
  return sanitizeText(name, 200);
}

export function validateJsonContent(content: unknown): Record<string, unknown> | null {
  if (content === null || content === undefined) return {};
  if (typeof content !== 'object' || Array.isArray(content)) return null;
  return content as Record<string, unknown>;
}
