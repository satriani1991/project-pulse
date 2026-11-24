import { useQuery } from '@tanstack/react-query';
import type { AssetReport, Deployment, FileEvent, IntensityEntry, ManagedProcess, Notification, Overview, ProjectSummary, Recommendation, Settings, DependencyEdge, HeatmapDay } from '@pulse/shared';
import { api, qs } from '../services/api';

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api.get<ProjectSummary[]>('/api/projects') });
export const useProject = (id: string) => useQuery({ queryKey: ['projects', id], queryFn: () => api.get<ProjectSummary>(`/api/projects/${id}`) });
export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: () => api.get<Overview>('/api/analytics/overview') });
export const useHeatmap = (f: { projectId?: string; category?: string } = {}) => useQuery({ queryKey: ['heatmap', f], queryFn: () => api.get<{ days: HeatmapDay[]; total: number; max: number }>('/api/analytics/heatmap' + qs(f)) });
export const useIntensity = (days?: number) => useQuery({ queryKey: ['intensity', days], queryFn: () => api.get<IntensityEntry[]>('/api/analytics/intensity' + qs({ days })) });
export const useRecommendations = () => useQuery({ queryKey: ['recommendations'], queryFn: () => api.get<Recommendation[]>('/api/recommendations') });
export const useNotifications = () => useQuery({ queryKey: ['notifications'], queryFn: () => api.get<Notification[]>('/api/notifications') });
export const useProcesses = () => useQuery({ queryKey: ['processes'], queryFn: () => api.get<ManagedProcess[]>('/api/processes') });
export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api.get<{ settings: Settings; defaults: Settings }>('/api/settings') });
export const useActivity = (q: Record<string, string | number | undefined>) => useQuery({ queryKey: ['activity', q], queryFn: () => api.get<FileEvent[]>('/api/activity' + qs(q)) });
export const useDependencies = () => useQuery({ queryKey: ['dependencies'], queryFn: () => api.get<{ nodes: { id: string; name: string; category: string; lifecycle: string; lastLocalUpdate?: string; lastDeployment?: string }[]; edges: DependencyEdge[] }>('/api/dependencies') });
export const useAssetReport = (projectId?: string) => useQuery({
  queryKey: ['assets', projectId ?? '*'],
  queryFn: async () => projectId ? api.get<{ assets: import('@pulse/shared').Asset[]; report: AssetReport }>(`/api/projects/${projectId}/assets`) : { assets: [], report: await api.get<AssetReport>('/api/assets/report') },
});
export const useDeployments = (projectId: string) => useQuery({ queryKey: ['deployments', projectId], queryFn: () => api.get<{ deployments: Deployment[]; site?: { latestVersion?: string; releaseTime?: string; fetchedAt: string; error?: string }; frequency: { label: string; sessions: number; deployments: number }[] }>(`/api/projects/${projectId}/deployments`) });
export const useFrequency = (weeks = 12) => useQuery({ queryKey: ['frequency', weeks], queryFn: () => api.get<{ week: string; label: string; sessions: number; minutes: number; deployments: number }[]>('/api/analytics/frequency' + qs({ weeks })) });
export const useMonthly = () => useQuery({ queryKey: ['monthly'], queryFn: () => api.get<Record<string, number | string>[]>('/api/analytics/monthly') });
export const useTasks = (projectId?: string) => useQuery({ queryKey: ['tasks', projectId ?? ''], queryFn: () => api.get<(import('@pulse/shared').Task & { projectName?: string })[]>('/api/tasks' + qs({ projectId })) });

export interface WorkspaceInfo { id: string; name: string; color: string; theme: 'dark' | 'light' | 'system'; createdAt: string; projectCount: number }
export const useWorkspaces = () => useQuery({ queryKey: ['workspaces'], queryFn: () => api.get<WorkspaceInfo[]>('/api/workspaces'), staleTime: 60_000 });
