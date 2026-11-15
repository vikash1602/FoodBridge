/** Auth queries + the user context store. */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext } from "react";

import { api, tokens } from "./client";
import type { User } from "./types";

export async function login(email: string, password: string): Promise<{ user: User; access: string; refresh: string }> {
  const data = await api.post<{ user: User; access: string; refresh: string }>("/auth/login/", { email, password });
  tokens.set(data.access, data.refresh);
  return data;
}

export async function register(payload: {
  email: string;
  password: string;
  confirm_password: string;
  role: "donor" | "volunteer";
  full_name: string;
  phone?: string;
}): Promise<User> {
  return api.post<User>("/auth/register/", payload);
}

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<User>("/auth/me/"),
    enabled: Boolean(tokens.access),
    staleTime: 30_000,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return () => {
    tokens.clear();
    queryClient.clear();
  };
}

interface AuthState {
  user: User | undefined;
  isLoading: boolean;
  isLoggedIn: boolean;
}

const AuthContext = createContext<AuthState>({
  user: undefined,
  isLoading: true,
  isLoggedIn: false,
});

export const AuthProvider = AuthContext.Provider;
export const useAuth = (): AuthState => {
  const { data, isLoading } = useMe();
  const isLoggedIn = Boolean(tokens.access);
  return {
    user: isLoggedIn ? data : undefined,
    isLoading: isLoading && isLoggedIn,
    isLoggedIn,
  };
};
