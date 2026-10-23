/**
 * Brand identity, defined ONCE.
 *
 * The same codebase serves TataCLiQ Fashion and TataCLiQ Luxury from two
 * repos, two Supabase projects and two Vercel projects. Only the deployment
 * differs, so branding is an environment variable rather than a code edit —
 * a fix can then be copied between the repos untouched.
 *
 * `NEXT_PUBLIC_` is required: the title renders in the browser.
 */

export type Brand = "fashion" | "luxury";

export const BRAND_TITLES: Record<Brand, string> = {
  fashion: "Push Notification Planning - TataCLiQ Fashion",
  luxury: "Push Notification Planning - TataCLiQ Luxury",
};

/**
 * Defaults to "fashion" when unset or unrecognised, so the live Fashion
 * deployment keeps working if the variable is ever missing. An unknown
 * value falls back rather than rendering something broken.
 */
export function resolveBrand(raw: string | undefined = process.env.NEXT_PUBLIC_BRAND): Brand {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "luxury" ? "luxury" : "fashion";
}

export const BRAND: Brand = resolveBrand();

/** The one product title, used by the login page, the shell and the tab. */
export const BRAND_TITLE: string = BRAND_TITLES[BRAND];
