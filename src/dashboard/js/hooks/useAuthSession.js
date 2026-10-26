import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '../services/apiClient.js';
import { removeStorage } from '../storage.js';

function normalizeUser(payload) {
  return payload?.user || payload?.me || payload?.data?.user || payload?.data || null;
}

function getAvatarUrl(user) {
  if (!user) return '';
  if (user.avatarUrl) return user.avatarUrl;
  if (user.avatarURL) return user.avatarURL;

  if (typeof user.avatar === 'string' && user.id) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=256`;
  }

  return user.image || user.profileImage || '';
}

function getDisplayName(user) {
  return (
    user?.global_name ||
    user?.globalName ||
    user?.displayName ||
    user?.username ||
    user?.name ||
    'User'
  );
}

export function useAuthSession({
  loadGuilds,
  loadBotStatus,
  applyBotProfile,
  clearGuilds,
} = {}) {
  const sessionLoadedRef = useRef(false);

  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginPending, setLoginPending] = useState(false);

  const clearAuthState = useCallback(() => {
    setIsAuthenticated(false);
    setCurrentUser(null);

    if (clearGuilds) {
      clearGuilds();
    }
  }, [clearGuilds]);

  const loadSession = useCallback(async () => {
    try {
      setAuthLoading(true);

      const authResponse = await api.getAuthMe();

      const authenticated = Boolean(
        authResponse?.authenticated ??
          authResponse?.isAuthenticated ??
          authResponse?.user
      );

      if (!authenticated) {
        clearAuthState();
        return;
      }

      setIsAuthenticated(true);
      setCurrentUser(normalizeUser(authResponse));

      const botPayload =
        authResponse?.bot ||
        authResponse?.client ||
        authResponse?.application;

      if (botPayload && applyBotProfile) {
        applyBotProfile({
          name:
            botPayload.name ||
            botPayload.username ||
            botPayload.displayName ||
            botPayload.global_name ||
            botPayload.globalName ||
            'Goliath',
          avatar: botPayload.avatarUrl || botPayload.avatarURL || '',
          raw: botPayload,
        });
      }

      if (authResponse.user?.isOwner !== true) removeStorage('owner_managed_guild');
      if (authResponse.user?.dashboardAllowed !== true && authResponse.user?.isOwner !== true) {
        clearGuilds?.();
        return;
      }
      if (loadGuilds) await loadGuilds();
      if (loadBotStatus) await loadBotStatus();
    } catch (error) {
      console.error('Session check failed:', error);
      clearAuthState();
    } finally {
      setAuthLoading(false);
      setLoginPending(false);
    }
  }, [applyBotProfile, clearAuthState, loadBotStatus, loadGuilds]);

  useEffect(() => {
    if (sessionLoadedRef.current) return;

    sessionLoadedRef.current = true;
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const refresh = () => loadSession();
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, [isAuthenticated, loadSession]);

  const handleLogin = useCallback(() => {
    setLoginPending(true);
    window.location.href = api.getLoginUrl();
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      setAuthLoading(true);
      await api.logout();
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      clearAuthState();
      setAuthLoading(false);
    }
  }, [clearAuthState]);

  return {
    authLoading,
    isAuthenticated,
    currentUser,
    currentUserName: getDisplayName(currentUser),
    currentUserAvatar: getAvatarUrl(currentUser),
    loginPending,
    loadSession,
    handleLogin,
    handleLogout,
    clearAuthState,
  };
}

