"use client";

import {
  AuthLoginResponseSchema,
  AuthMeResponseSchema,
  AuthLogoutResponseSchema,
  createApiSuccessResponseSchema,
  type AuthLoginResponse,
  type AuthMeResponse,
} from "@shearer/contracts";

const AuthLoginApiResponseSchema = createApiSuccessResponseSchema(AuthLoginResponseSchema);
const AuthMeApiResponseSchema = createApiSuccessResponseSchema(AuthMeResponseSchema);
const AuthLogoutApiResponseSchema = createApiSuccessResponseSchema(AuthLogoutResponseSchema);

const AUTH_SESSION_KEY = "cmTablet.auth.session";

type StoredAuthSession = {
  accessToken: string;
  expiresAt: string;
};

export const resolveHttpBase = () => {
  if (typeof window === "undefined") {
    return "";
  }

  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }

  const { protocol, hostname, port } = window.location;

  if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "3000") {
    return `${protocol}//${hostname}:18080`;
  }

  return `${protocol}//${window.location.host}`;
};

const isBrowser = () => typeof window !== "undefined";

export const getStoredAuthSession = (): StoredAuthSession | null => {
  if (!isBrowser()) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(AUTH_SESSION_KEY);

    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as StoredAuthSession;

    if (!parsed.accessToken || !parsed.expiresAt) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

export const setStoredAuthSession = (session: StoredAuthSession) => {
  if (!isBrowser()) {
    return;
  }

  window.sessionStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
};

export const clearStoredAuthSession = () => {
  if (!isBrowser()) {
    return;
  }

  window.sessionStorage.removeItem(AUTH_SESSION_KEY);
};

export const getStoredAccessToken = () => {
  const session = getStoredAuthSession();

  if (!session) {
    return null;
  }

  if (Date.parse(session.expiresAt) <= Date.now()) {
    clearStoredAuthSession();
    return null;
  }

  return session.accessToken;
};

export const getSafeNextPath = (nextValue: string | null | undefined) => {
  if (!nextValue || !nextValue.startsWith("/") || nextValue.startsWith("//")) {
    return "/";
  }

  if (nextValue === "/login") {
    return "/";
  }

  return nextValue;
};

export const loginWithPassword = async ({
  employeeNo,
  password,
}: {
  employeeNo: string;
  password: string;
}): Promise<AuthLoginResponse> => {
  const response = await fetch(`${resolveHttpBase()}/api/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      employeeNo,
      password,
    }),
  });

  if (!response.ok) {
    throw new Error("AUTH_INVALID_CREDENTIALS");
  }

  const json = await response.json();
  const parsed = AuthLoginApiResponseSchema.parse(json);

  setStoredAuthSession({
    accessToken: parsed.data.accessToken,
    expiresAt: parsed.data.expiresAt,
  });

  return parsed.data;
};

export const fetchAuthMe = async (accessToken: string): Promise<AuthMeResponse> => {
  const response = await fetch(`${resolveHttpBase()}/api/auth/me`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error("AUTH_UNAUTHORIZED");
  }

  const json = await response.json();
  const parsed = AuthMeApiResponseSchema.parse(json);

  setStoredAuthSession({
    accessToken,
    expiresAt: parsed.data.expiresAt,
  });

  return parsed.data;
};

export const logoutCurrentSession = async (accessToken: string | null) => {
  try {
    if (accessToken) {
      const response = await fetch(`${resolveHttpBase()}/api/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.ok) {
        const json = await response.json();
        AuthLogoutApiResponseSchema.parse(json);
      }
    }
  } finally {
    clearStoredAuthSession();
  }
};
