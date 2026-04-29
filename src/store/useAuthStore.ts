import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabaseClient';

export type UserRole = 'admin' | 'client';

export interface Account {
  id: string;
  name: string;
  status: 'active' | 'suspended';
  wordpress_site_limit: number;
  feature_flags: Record<string, boolean>;
  monthly_article_limit: number | null;
}

export interface Profile {
  id: string;
  user_id: string;
  account_id: string | null;
  role: UserRole;
  display_name: string | null;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  account: Account | null;
  isLoading: boolean;
  error: string | null;
  isAdmin: boolean;
  isClient: boolean;
  loadAuth: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

const loadProfile = async (userId: string): Promise<{ profile: Profile | null; account: Account | null }> => {
  if (!supabase) {
    return { profile: null, account: null };
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id,user_id,account_id,role,display_name')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!profile) {
    return { profile: null, account: null };
  }

  if (!profile.account_id) {
    return { profile: profile as Profile, account: null };
  }

  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('id,name,status,wordpress_site_limit,feature_flags,monthly_article_limit')
    .eq('id', profile.account_id)
    .maybeSingle();

  if (accountError) {
    throw accountError;
  }

  return {
    profile: profile as Profile,
    account: (account as Account | null) ?? null,
  };
};

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  account: null,
  isLoading: true,
  error: null,
  isAdmin: false,
  isClient: false,

  loadAuth: async () => {
    if (!supabase) {
      set({
        session: null,
        user: null,
        profile: null,
        account: null,
        isLoading: false,
        error: 'Supabase configuration is missing.',
        isAdmin: false,
        isClient: false,
      });
      return;
    }

    set({ isLoading: true, error: null });

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      const session = data.session;
      const user = session?.user ?? null;

      if (!user) {
        set({
          session: null,
          user: null,
          profile: null,
          account: null,
          isLoading: false,
          isAdmin: false,
          isClient: false,
        });
        return;
      }

      const { profile, account } = await loadProfile(user.id);
      const role = profile?.role ?? null;

      set({
        session,
        user,
        profile,
        account,
        isLoading: false,
        isAdmin: role === 'admin',
        isClient: role === 'client',
      });
    } catch (error) {
      set({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load authentication state.',
      });
    }
  },

  signInWithPassword: async (email, password) => {
    if (!supabase) {
      throw new Error('Supabase configuration is missing.');
    }

    set({ isLoading: true, error: null });

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ isLoading: false, error: error.message });
      throw error;
    }

    await get().loadAuth();
  },

  signInWithGoogle: async () => {
    if (!supabase) {
      throw new Error('Supabase configuration is missing.');
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });

    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signOut: async () => {
    if (supabase) {
      await supabase.auth.signOut();
    }

    set({
      session: null,
      user: null,
      profile: null,
      account: null,
      isLoading: false,
      error: null,
      isAdmin: false,
      isClient: false,
    });
  },
}));
