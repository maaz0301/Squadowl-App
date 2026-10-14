import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

export type AnnouncementSeverity = 'info' | 'warning' | 'critical';

export interface PlatformAnnouncement {
  id: string;
  title: string;
  message: string;
  severity: AnnouncementSeverity;
}

/** Announcements live right now. Readable by every signed-in user; a missing table just means none. */
export async function listActiveAnnouncements(): Promise<PlatformAnnouncement[]> {
  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabase()
    .from('platform_announcements')
    .select('id, title, message, severity')
    .lte('starts_at', nowIso)
    .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('Could not load announcements:', error.message);
    return [];
  }
  return (data ?? []) as PlatformAnnouncement[];
}

export function useActiveAnnouncementsQuery(enabled = true) {
  return useQuery({
    queryKey: ['announcements', 'active'],
    queryFn: listActiveAnnouncements,
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}
