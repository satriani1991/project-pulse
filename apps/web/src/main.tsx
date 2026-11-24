import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import { AppLayout } from './layouts/AppLayout';
import { ToastProvider } from './components/ui';
import { OverviewPage } from './pages/Overview';
import { ProjectsPage } from './pages/Projects';
import { ProjectDetailPage } from './pages/ProjectDetail';
import { DeploymentsPage } from './pages/Deployments';
import { ActivityPage } from './pages/Activity';
import { AnalyticsPage } from './pages/Analytics';
import { AssetsPage } from './pages/Assets';
import { DependenciesPage } from './pages/Dependencies';
import { TasksPage } from './pages/Tasks';
import { ServersPage } from './pages/Servers';
import { SettingsPage } from './pages/Settings';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } } });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<OverviewPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/category/:category" element={<ProjectsPage />} />
              <Route path="projects/:id" element={<ProjectDetailPage />} />
              <Route path="deployments" element={<DeploymentsPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="analytics" element={<AnalyticsPage />} />
              <Route path="assets" element={<AssetsPage />} />
              <Route path="dependencies" element={<DependenciesPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="servers" element={<ServersPage />} />
              <Route path="archive" element={<ProjectsPage archive />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<OverviewPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
