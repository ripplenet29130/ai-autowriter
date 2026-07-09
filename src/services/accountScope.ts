import { useAuthStore } from '../store/useAuthStore';

export const getCurrentAccountId = (): string | null => {
  return useAuthStore.getState().account?.id ?? null;
};

export const getCurrentUserId = (): string | null => {
  return useAuthStore.getState().user?.id ?? null;
};

export const isCurrentUserAdmin = (): boolean => {
  return useAuthStore.getState().isAdmin;
};

export const getRequiredAccountId = (): string => {
  const accountId = getCurrentAccountId();

  if (!accountId) {
    throw new Error('No active account is available.');
  }

  return accountId;
};

export const getRequiredUserId = (): string => {
  const userId = getCurrentUserId();

  if (!userId) {
    throw new Error('No active user is available.');
  }

  return userId;
};

export const getOwnershipInsertFields = () => ({
  account_id: getRequiredAccountId(),
  user_id: getRequiredUserId(),
});

export const scopeQueryToCurrentUser = <TQuery>(query: TQuery): TQuery => {
  if (isCurrentUserAdmin()) return query;

  const userId = getCurrentUserId();
  if (!userId) {
    return (query as any).eq('user_id', '00000000-0000-0000-0000-000000000000');
  }

  return (query as any).eq('user_id', userId);
};

export const scopeMutationToCurrentUser = <TQuery>(query: TQuery): TQuery => {
  return (query as any)
    .eq('account_id', getRequiredAccountId())
    .eq('user_id', getRequiredUserId());
};
