/**
 * The paging rule from `listCampaigns`, extracted so it can be tested
 * against a fetcher that enforces a 1,000-row cap — which is what PostgREST
 * does, silently, and what caused the dashboard to show only the first
 * 1,000 of 3,000 campaigns.
 */
export const PAGE_SIZE = 1000;

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  pageSize = PAGE_SIZE,
  hardCap = 100_000
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    all.push(...page);
    if (page.length < pageSize || all.length > hardCap) break;
  }
  return all;
}
