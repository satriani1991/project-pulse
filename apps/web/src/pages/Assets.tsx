import { useSearchParams } from 'react-router-dom';
import { useProjects } from '../hooks/queries';
import { AssetExplorer } from '../components/AssetExplorer';
import { Select } from '../components/ui';

export function AssetsPage() {
  const [sp, setSp] = useSearchParams();
  const { data: projects } = useProjects();
  const pid = sp.get('project') ?? '';
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Game asset inventory</h1>
        <Select value={pid} onChange={(e) => setSp(e.target.value ? { project: e.target.value } : {})} aria-label="Project">
          <option value="">Whole workspace</option>
          {projects?.filter((p) => p.stats.assetFiles > 0 || p.category === 'game').map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </div>
      <AssetExplorer key={pid} projectId={pid || undefined} />
    </div>
  );
}
