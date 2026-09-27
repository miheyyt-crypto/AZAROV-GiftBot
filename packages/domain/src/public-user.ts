/**
 * Canonical public presentation fields for Mini App read models.
 * Never include telegram numeric id, session tokens, roles, wallet ids, or OAuth secrets.
 */
export type PublicUserSummary = {
  publicId: string | null;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export function toPublicUserSummary(input: {
  publicId?: string | null;
  displayName?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
}): PublicUserSummary {
  return {
    publicId: input.publicId ?? null,
    displayName: input.displayName ?? null,
    username: input.username ?? null,
    avatarUrl: input.avatarUrl ?? null,
  };
}
