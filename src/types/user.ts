export type AppRole = "CATEGORY" | "CRM" | "CONTENT" | "EXECUTIVE";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  role: AppRole;
  created_at: string;
}

/** The login screen asks for a username; Supabase Auth needs an email. */
export const USERNAME_TO_EMAIL: Record<string, string> = {
  CATEGORY: "category@internal.local",
  CRM: "crm@internal.local",
  CONTENT: "content@internal.local",
  EXECUTIVE: "executive@internal.local",
};

export const HOME_FOR_ROLE: Record<AppRole, string> = {
  CATEGORY: "/overview",
  CRM: "/overview",
  CONTENT: "/overview",
  EXECUTIVE: "/overview",
};
