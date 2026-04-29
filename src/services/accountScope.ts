import { useAuthStore } from '../store/useAuthStore';

export const getCurrentAccountId = (): string | null => {
  return useAuthStore.getState().account?.id ?? null;
};

export const getRequiredAccountId = (): string => {
  const accountId = getCurrentAccountId();

  if (!accountId) {
    throw new Error('No active account is available.');
  }

  return accountId;
};
