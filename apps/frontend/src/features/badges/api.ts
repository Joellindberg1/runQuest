import type {
  ApiSuccess, BadgeGroupMeta, BadgeGroupResponse, BadgeUserResponse, SeenRequest, SeenResponse, ShowcaseRequest, ShowcaseResponse,
} from '@runquest/shared';
import { backendApi } from '@/shared/services/backendApi';

/** GET /badges/group med `meta.member_count` inpackat (null = servern uteslöt den; held-by utelämnas då). */
export interface GroupBadges extends BadgeGroupResponse {
  member_count: number | null;
}

// Egen tunn klient ovanpå backendApi.authenticatedRequest (token, 401-hantering, bas-URL) så att backendApi.ts inte växer med varje feature.
// Allt som inte är ett { success, data }-svar kastas — react-query gör kastet till felläge, optimistiska uppdateringar återställs.
async function request<T, M = undefined>(endpoint: string, options?: { method?: 'POST' | 'PUT'; body?: ShowcaseRequest | SeenRequest }): Promise<ApiSuccess<T, M>> {
  const res = await backendApi.authenticatedRequest<ApiSuccess<T, M>>(endpoint, options);
  if (!res.success) throw new Error(res.error || 'Request failed');
  if (!res.data?.data) throw new Error('Unexpected response from the server');
  return res.data;
}

export const badgesApi = {
  /** GET /badges/user/:userId — ägda serier (låsta saknas), valda badges; `seen_tier` bara för anroparen själv. 404 = inte i min grupp. */
  async getUserBadges(userId: string): Promise<BadgeUserResponse> {
    return (await request<BadgeUserResponse>(`/badges/user/${encodeURIComponent(userId)}`)).data;
  },

  /** GET /badges/group — gruppens medlemmars valda badges och `holders` (antal på tier eller högre) per serie och tier. */
  async getGroupBadges(): Promise<GroupBadges> {
    const body = await request<BadgeGroupResponse, BadgeGroupMeta>('/badges/group');
    return { ...body.data, member_count: body.meta?.member_count ?? null };
  },

  /** PUT /badges/showcase — högst tre, unika, kända och ägda serier i visningsordning; annars 400 med serverns text. [] rensar. */
  async saveShowcase(series: readonly string[]): Promise<ShowcaseResponse> {
    return (await request<ShowcaseResponse>('/badges/showcase', { method: 'PUT', body: { series: [...series] } })).data;
  },

  /** POST /badges/seen — utan `series` markeras alla anroparens serier (serverns betydelse), `[]` markerar inga. */
  async markSeen(series?: readonly string[]): Promise<SeenResponse> {
    return (await request<SeenResponse>('/badges/seen', { method: 'POST', body: series === undefined ? {} : { series: [...series] } })).data;
  },
};
