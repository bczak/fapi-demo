import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { encodeBasicAuth } from "../lib/basic-auth";

interface AdminAuthState {
  /** Ready-made `Basic ...` header value, or null when logged out. */
  authorization: string | null;
  login: (user: string, password: string) => void;
  logout: () => void;
}

// The header is a reusable password, so it lives in sessionStorage only (gone with the tab) and never in
// the query cache. A production app should use an HttpOnly session cookie instead, out of reach of scripts.
export const useAdminAuth = create<AdminAuthState>()(
  persist(
    (set) => ({
      authorization: null,
      login: (user, password) => set({ authorization: encodeBasicAuth(user, password) }),
      logout: () => set({ authorization: null }),
    }),
    { name: "admin-auth", storage: createJSONStorage(() => sessionStorage) },
  ),
);
